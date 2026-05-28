"""KB 文档管理 admin 接口。

约定：所有上传文件落到 settings 配置的本地目录（MVP，不用 OSS/MinIO），
默认在 FastAPI 进程内联执行 ingestion。Milvus Lite 使用本地文件锁，不适合作为
FastAPI + Celery 多进程共享写入目标；如需 Celery，显式设置 CELERY_ENABLED=true。
"""
from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    DocStatus,
    KbChunk,
    KbDocument,
    KpChunkLink,
    KpExtractionJob,
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    ProductLinkSource,
    get_session,
)
from ..schemas import DocBackfillRequest
from ..vector_store import delete_by_doc

router = APIRouter()


from ..config import settings as _settings  # noqa: E402

_UPLOAD_DIR = (
    Path(_settings.uploads_dir)
    if _settings.uploads_dir
    else Path(__file__).resolve().parents[3] / "server" / "uploads"
)
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_ALLOWED_EXT = {".pdf", ".pptx", ".md", ".txt"}


def _doc_to_dict(doc: KbDocument, product: Product | None = None) -> dict[str, Any]:
    return {
        "id": doc.id,
        "file_name": doc.file_name,
        "mime": doc.mime,
        "status": doc.status.value if hasattr(doc.status, "value") else str(doc.status),
        "chunk_count": doc.chunk_count,
        "error": doc.error or "",
        "product_id": doc.product_id,
        "product": (
            {"id": product.id, "code": product.code, "name": product.name} if product else None
        ),
        "created_at": doc.created_at.isoformat() if doc.created_at else "",
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else "",
    }


def _job_to_dict(job: KpExtractionJob | None) -> dict[str, Any] | None:
    if job is None:
        return None
    return {
        "id": job.id,
        "doc_id": job.doc_id,
        "status": job.status,
        "candidate_count": job.candidate_count,
        "new_kp_count": job.new_kp_count,
        "error": job.error or "",
        "created_at": job.created_at.isoformat() if job.created_at else "",
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@router.post("/admin/kb/upload")
async def upload_document(
    file: UploadFile = File(...),
    product_id: int = Form(...),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    name = file.filename or "unnamed"
    ext = Path(name).suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(400, f"不支持的文件类型: {ext}")

    # 校验 product 存在
    product = await session.get(Product, product_id)
    if not product:
        raise HTTPException(400, f"product_id={product_id} 不存在")

    saved_name = f"{uuid.uuid4().hex}{ext}"
    saved_path = _UPLOAD_DIR / saved_name

    # 大文件复制是阻塞 IO，丢线程池；UploadFile.file 是 SpooledTemporaryFile 同步对象
    def _copy_to_disk() -> None:
        with saved_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

    await asyncio.to_thread(_copy_to_disk)

    if _settings.celery_enabled:
        # Celery .delay() 走 Redis broker，也是同步 IO（amqp/redis-py sync 客户端）
        try:
            from ..celery_app import ingest_document_task

            async_result = await asyncio.to_thread(
                ingest_document_task.delay, str(saved_path), product_id
            )
            return {
                "ok": True,
                "file_name": name,
                "task_id": async_result.id,
                "mode": "celery",
                "saved_path": str(saved_path),
                "product_id": product_id,
            }
        except Exception as e:
            celery_error = repr(e)[:200]
    else:
        celery_error = "CELERY_ENABLED=false"

    from ..ingestion.pipeline import ingest_document_sync

    try:
        # 同步 pipeline 内部会调 embed_sync (asyncio.run) —— 必须丢线程池跑，
        # 否则在 FastAPI event loop 里会 RuntimeError: asyncio.run() cannot be called from a running event loop
        doc_id = await asyncio.to_thread(
            ingest_document_sync, str(saved_path), product_id=product_id
        )
        return {
            "ok": True,
            "file_name": name,
            "doc_id": doc_id,
            "mode": "inline",
            "celery_error": celery_error,
            "product_id": product_id,
        }
    except Exception as inner:
        raise HTTPException(500, f"入库失败: {inner!r}")


@router.get("/admin/kb/documents")
async def list_documents(
    status: str | None = Query(None),
    product_id: int | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = select(KbDocument).order_by(KbDocument.id.desc()).offset(offset).limit(limit)
    count_stmt = select(func.count(KbDocument.id))
    if status:
        stmt = stmt.where(KbDocument.status == status)
        count_stmt = count_stmt.where(KbDocument.status == status)
    if product_id is not None:
        stmt = stmt.where(KbDocument.product_id == product_id)
        count_stmt = count_stmt.where(KbDocument.product_id == product_id)
    rows = (await session.execute(stmt)).scalars().all()

    # 批量预取 product
    pids = {d.product_id for d in rows if d.product_id}
    products: dict[int, Product] = {}
    if pids:
        prod_rows = (
            await session.execute(select(Product).where(Product.id.in_(pids)))
        ).scalars().all()
        products = {p.id: p for p in prod_rows}

    total = (await session.execute(count_stmt)).scalar_one()
    return {
        "items": [_doc_to_dict(d, products.get(d.product_id)) for d in rows],
        "total": int(total),
    }


@router.get("/admin/kb/documents/{doc_id}")
async def get_document(doc_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    doc = await session.get(KbDocument, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    job = (
        await session.execute(
            select(KpExtractionJob)
            .where(KpExtractionJob.doc_id == doc_id)
            .order_by(desc(KpExtractionJob.id))
            .limit(1)
        )
    ).scalar_one_or_none()
    product = await session.get(Product, doc.product_id) if doc.product_id else None
    return {
        **_doc_to_dict(doc, product),
        "source_path": doc.source_path,
        "latest_job": _job_to_dict(job),
    }


@router.post("/admin/kb/documents/{doc_id}/backfill-product")
async def backfill_product(
    doc_id: int,
    body: DocBackfillRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """把 doc 绑到 product，并把该 doc 下所有 KP 都补上 product link。"""
    doc = await session.get(KbDocument, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    product = await session.get(Product, body.product_id)
    if not product:
        raise HTTPException(400, f"product {body.product_id} 不存在")

    doc.product_id = body.product_id
    # 找该 doc 下所有 KP id
    kp_ids = (
        await session.execute(
            select(KpChunkLink.kp_id)
            .join(KbChunk, KbChunk.id == KpChunkLink.chunk_id)
            .where(KbChunk.doc_id == doc_id)
            .distinct()
        )
    ).scalars().all()
    kp_ids = [int(k) for k in kp_ids]

    # 已存在的 link 跳过
    existing = set(
        (
            await session.execute(
                select(KpProductLink.kp_id)
                .where(KpProductLink.product_id == body.product_id)
                .where(KpProductLink.kp_id.in_(kp_ids) if kp_ids else False)
            )
        ).scalars().all()
    )
    added = 0
    for kid in kp_ids:
        if kid in existing:
            continue
        session.add(
            KpProductLink(kp_id=kid, product_id=body.product_id, source=ProductLinkSource.auto)
        )
        added += 1
    await session.commit()
    return {"ok": True, "doc_id": doc_id, "total_kps": len(kp_ids), "added_links": added}


@router.post("/admin/kb/documents/{doc_id}/reextract")
async def reextract_kps(doc_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    doc = await session.get(KbDocument, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    if _settings.celery_enabled:
        try:
            from ..celery_app import extract_kps_task

            r = await asyncio.to_thread(extract_kps_task.delay, doc_id)
            return {"ok": True, "task_id": r.id, "mode": "celery"}
        except Exception as e:
            celery_error = repr(e)[:200]
    else:
        celery_error = "CELERY_ENABLED=false"

    from ..kp_extraction.extractor import extract_kps_sync

    result = await asyncio.to_thread(extract_kps_sync, doc_id)
    return {"ok": True, "mode": "inline", "celery_error": celery_error, "result": result}


@router.delete("/admin/kb/documents/{doc_id}")
async def delete_document(doc_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    doc = await session.get(KbDocument, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    # 先删 Milvus 向量（同步 gRPC，丢线程池），再删 MySQL（级联到 chunks/links/jobs）
    try:
        await asyncio.to_thread(delete_by_doc, doc_id)
    except Exception as e:
        # Milvus 删除失败不阻断 MySQL 清理，但记到响应里
        milvus_error = repr(e)[:200]
    else:
        milvus_error = ""
    await session.delete(doc)
    await session.commit()
    return {"ok": True, "milvus_error": milvus_error}


@router.get("/admin/kb/documents/{doc_id}/chunks")
async def list_doc_chunks(
    doc_id: int,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    doc = await session.get(KbDocument, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    chunks = (
        await session.execute(
            select(KbChunk)
            .where(KbChunk.doc_id == doc_id)
            .order_by(KbChunk.chunk_index)
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()

    chunk_ids = [c.id for c in chunks]
    kp_by_chunk: dict[int, list[int]] = {cid: [] for cid in chunk_ids}
    if chunk_ids:
        link_rows = (
            await session.execute(
                select(KpChunkLink.chunk_id, KpChunkLink.kp_id)
                .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
                .where(KpChunkLink.chunk_id.in_(chunk_ids))
                .where(KpRegistry.status != KpStatus.archived)
            )
        ).all()
        for cid, kid in link_rows:
            kp_by_chunk.setdefault(int(cid), []).append(int(kid))

    return {
        "items": [
            {
                "id": c.id,
                "chunk_index": c.chunk_index,
                "text": c.text,
                "token_count": c.token_count,
                "meta": c.meta or {},
                "kp_ids": kp_by_chunk.get(c.id, []),
            }
            for c in chunks
        ],
        "total": doc.chunk_count,
    }
