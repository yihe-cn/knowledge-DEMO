"""检索 + Prompt 防注入工具，供 qa_graph / suggestor_graph 共用。"""
from __future__ import annotations

import asyncio
import re

from sqlalchemy import select

from ..db import KbChunk, KbDocument, KpChunkLink, KpRegistry, KpStatus, Product, SessionLocal
from ..embeddings import embed
from ..vector_store import search as milvus_search


class RetrievalError(RuntimeError):
    """检索基础设施故障（embedding / Milvus / DB）。route 层应转 5xx。"""


class UnknownProductError(ValueError):
    """传了 product_code 但 DB 里查不到。route 层应转 400。"""


_FENCE_RE = re.compile(r"</(CTX|CAND|DOC|DIALOG|KP|KPMETA|PERSONA)-[A-Za-z0-9]+>")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def sanitize_for_fence(text: str, nonce: str | None = None) -> str:
    """把 RAG 内容里的伪造结束标签替换掉，防止跑出 prompt 沙盒。

    nonce 参数保留以兼容旧签名，实际匹配任意 nonce。
    """
    return _FENCE_RE.sub("[fence-removed]", text or "")


def sanitize_untrusted(text: str | None, *, max_len: int = 600) -> str:
    """处理任何不可信外部文本（前端 customer 字段 / history / kp_list summary）。

    - 去控制字符
    - 去伪造 fence
    - 截断到 max_len（避免攻击者塞超长内容稀释 system prompt）
    """
    if not text:
        return ""
    s = _CONTROL_RE.sub(" ", str(text))
    s = _FENCE_RE.sub("[fence-removed]", s)
    s = s.strip()
    if len(s) > max_len:
        s = s[:max_len] + "…"
    return s


async def retrieve_chunks(
    query: str,
    product_code: str | None = None,
    top_k: int = 12,
) -> list[dict]:
    """根据 query 检索知识库 chunk，按 product 严格过滤，附带 chunk 上的 approved KP。

    错误语义：
      - 空 query → 返回 []
      - product_code 给了但 DB 查不到 → 抛 UnknownProductError
      - embedding / Milvus / DB 故障 → 抛 RetrievalError
      - 检索成功但无命中 → 返回 []

    隔离实现：先把 product_code 翻成 doc_ids（很小的集合），作为 Milvus expr 过滤条件，
    然后请求精确的 top_k；不再走 SQL 后置过滤，避免本产品 chunk 排在 over-fetch 阈值外被漏掉。
    """
    query = (query or "").strip()
    if not query:
        return []

    try:
        vecs = await embed([query])
    except Exception as e:
        raise RetrievalError(f"embedding 失败: {e}") from e
    if not vecs:
        raise RetrievalError("embedding 返回空")

    # 先把产品维度的过滤集合算出来；product_code 不存在直接抛错（不能静默成全库）
    product_id: int | None = None
    product_doc_ids: list[int] | None = None
    try:
        async with SessionLocal() as session:
            if product_code:
                product_id = (
                    await session.execute(select(Product.id).where(Product.code == product_code))
                ).scalar_one_or_none()
                if product_id is None:
                    raise UnknownProductError(f"product_code={product_code!r} 不存在")
                product_doc_ids = [
                    int(d)
                    for d in (
                        await session.execute(
                            select(KbDocument.id).where(KbDocument.product_id == product_id)
                        )
                    ).scalars().all()
                ]
                if not product_doc_ids:
                    # 该产品下还没有任何文档，注定召回为空
                    return []
    except UnknownProductError:
        raise
    except Exception as e:
        raise RetrievalError(f"DB 查询失败: {e}") from e

    try:
        hits = await asyncio.to_thread(
            milvus_search, vecs[0], top_k, None, product_doc_ids
        )
    except Exception as e:
        raise RetrievalError(f"Milvus 检索失败: {e}") from e
    if not hits:
        return []

    chunk_ids = [h["chunk_id"] for h in hits]
    try:
        async with SessionLocal() as session:
            chunk_stmt = (
                select(KbChunk, KbDocument)
                .join(KbDocument, KbDocument.id == KbChunk.doc_id)
                .where(KbChunk.id.in_(chunk_ids))
            )
            # 防 TOCTOU：Milvus 检索后、SQL 取详情前，若管理员把某个 doc 改到别的 product，
            # 必须按"当前 DB 里 doc 真实属于的 product_id"再过滤一次。
            # 不能复用 product_doc_ids 快照——那是旧状态，已改走的 doc id 仍在里面。
            if product_id is not None:
                chunk_stmt = chunk_stmt.where(KbDocument.product_id == product_id)
            rows = (await session.execute(chunk_stmt)).all()
            chunk_map = {c.id: (c, d) for c, d in rows}

            kp_links = (
                await session.execute(
                    select(KpChunkLink, KpRegistry)
                    .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
                    .where(KpChunkLink.chunk_id.in_(chunk_ids))
                    .where(KpRegistry.status == KpStatus.approved)
                )
            ).all()
            kp_per_chunk: dict[int, list[dict]] = {}
            for link, kp in kp_links:
                kp_per_chunk.setdefault(link.chunk_id, []).append(
                    {"kp_id": kp.id, "name": kp.name, "link_relevance": float(link.relevance or 0.0)}
                )
    except UnknownProductError:
        raise
    except Exception as e:
        raise RetrievalError(f"DB 查询失败: {e}") from e

    candidates: list[dict] = []
    for h in hits:
        if len(candidates) >= top_k:
            break
        pair = chunk_map.get(h["chunk_id"])
        if not pair:
            continue
        chunk, doc = pair
        meta = chunk.meta or {}
        slide_indices = [
            int(s)
            for s in (meta.get("slide_indices") or [])
            if isinstance(s, (int, str)) and str(s).lstrip("-").isdigit()
        ]
        candidates.append(
            {
                "chunk_id": chunk.id,
                "score": h["score"],
                "doc_id": doc.id,
                "doc_name": doc.file_name,
                "slide_indices": slide_indices,
                "text": chunk.text,
                "kps": kp_per_chunk.get(chunk.id, []),
            }
        )
    return candidates
