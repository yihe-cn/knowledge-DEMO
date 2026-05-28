"""文档入库主管线（同步版，供 Celery worker 与 CLI 调用）。

原子性策略（MVP）：
- kb_document 行单独 commit 一次，作为「正在处理」的追踪记录（运维可见）
- 对 chunks + Milvus 部分采用「两阶段 + 补偿」：
  1) 先 embed；失败 → 没有任何副作用
  2) flush（不 commit）MySQL 拿到 chunk.id
  3) upsert Milvus
  4) commit MySQL；如果 commit 失败 → 反向 delete Milvus 的本批 chunk_ids（补偿）
  5) 全程任一步抛错都走 except 通道：rollback MySQL，必要时补偿 Milvus

成本：极少数情况下补偿本身可能也失败（如 Milvus 断网），这时把孤儿 chunk_id 写到
`kb_document.error` 字段，运维可手动跑 `delete_by_chunk_ids`。
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..db import DocStatus, KbChunk, KbDocument, SyncSessionLocal
from ..embeddings import embed_sync
from ..vector_store import delete_by_chunk_ids, upsert_chunks
from .chunker import chunk_sections
from .loaders import load_document


def _process(session: Session, doc: KbDocument) -> None:
    sections = load_document(doc.source_path)
    chunks = chunk_sections(sections)
    if not chunks:
        doc.status = DocStatus.ready
        doc.chunk_count = 0
        session.commit()
        return

    # 1) embed（外部 API，最易失败）—— 失败时无任何副作用
    vectors = embed_sync([c.text for c in chunks])
    if len(vectors) != len(chunks):
        raise RuntimeError(f"embed 数量不匹配: chunks={len(chunks)} vectors={len(vectors)}")

    # 2) flush MySQL 拿到 chunk.id（未 commit）
    chunk_rows: list[KbChunk] = []
    for i, c in enumerate(chunks):
        row = KbChunk(doc_id=doc.id, chunk_index=i, text=c.text, token_count=c.token_count, meta=c.meta)
        session.add(row)
        chunk_rows.append(row)
    session.flush()
    chunk_ids: list[int] = [int(r.id) for r in chunk_rows]

    # 3+4) upsert Milvus → commit MySQL；4 失败要补偿删 Milvus
    milvus_upserted = False
    try:
        upsert_chunks(
            [
                {"chunk_id": row.id, "doc_id": doc.id, "kp_ids": [], "vector": vec}
                for row, vec in zip(chunk_rows, vectors, strict=True)
            ]
        )
        milvus_upserted = True

        doc.chunk_count = len(chunk_rows)
        doc.status = DocStatus.ready
        session.commit()
    except Exception:
        session.rollback()
        if milvus_upserted:
            # MySQL commit 失败、Milvus 已写 → 补偿删除孤儿向量
            try:
                delete_by_chunk_ids(chunk_ids)
            except Exception as ce:
                # 补偿也失败：单开 session 把孤儿信息记到 doc.error
                with SyncSessionLocal() as recovery:
                    d = recovery.get(KbDocument, doc.id)
                    if d is not None:
                        sample = chunk_ids[:5]
                        msg = f"[orphan_milvus] count={len(chunk_ids)} sample={sample} compensate_failed={ce!r}"[:2000]
                        d.error = (d.error + " | " + msg) if d.error else msg
                        recovery.commit()
        raise


def ingest_document_sync(
    file_path: str, *, trigger_kp_extraction: bool = True, product_id: int | None = None
) -> int:
    """入库一个文档，返回 doc_id。"""
    p = Path(file_path).expanduser().resolve()
    with SyncSessionLocal() as session:
        doc = KbDocument(
            file_name=p.name,
            source_path=str(p),
            mime=p.suffix.lstrip(".").lower(),
            product_id=product_id,
            status=DocStatus.processing,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)

        try:
            _process(session, doc)
        except Exception as e:
            # _process 内部已尽力补偿，doc 行始终存在；这里把状态置 failed
            session.rollback()
            d = session.get(KbDocument, doc.id)
            if d is not None:
                d.status = DocStatus.failed
                extra = repr(e)[:2000]
                d.error = (d.error + " | " + extra) if d.error else extra
                session.commit()
            raise
        doc_id = doc.id

    if trigger_kp_extraction:
        if settings.celery_enabled:
            try:
                from ..celery_app import extract_kps_task  # 延迟导入避免 Celery 未启时阻塞 CLI
                extract_kps_task.delay(doc_id)
            except Exception as e:
                # Celery 不可达不影响入库本身，但要写到 doc.error 让运维能看到
                with SyncSessionLocal() as session:
                    doc = session.get(KbDocument, doc_id)
                    if doc is not None:
                        msg = f"[kp_extract_dispatch_failed] {e!r}"[:2000]
                        doc.error = (doc.error + " | " + msg) if doc.error else msg
                        session.commit()
        else:
            try:
                from ..kp_extraction.extractor import extract_kps_sync
                extract_kps_sync(doc_id)
            except Exception as e:
                with SyncSessionLocal() as session:
                    doc = session.get(KbDocument, doc_id)
                    if doc is not None:
                        msg = f"[kp_extract_inline_failed] {e!r}"[:2000]
                        doc.error = (doc.error + " | " + msg) if doc.error else msg
                        session.commit()

    return doc_id
