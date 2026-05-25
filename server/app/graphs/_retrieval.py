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


_FENCE_RE = re.compile(r"</(CTX|CAND|DOC|DIALOG|KP|KPMETA|PERSONA|BRIEF|Q|A|S)-[A-Za-z0-9]+>")
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


async def _resolve_product_doc_ids(product_code: str | None) -> tuple[int | None, list[int] | None]:
    """把 product_code 解析成 (product_id, doc_id 列表)。
    返回 (None, None) 表示无产品过滤；(id, []) 表示产品存在但没文档；抛 UnknownProductError 表示产品不存在。
    """
    if not product_code:
        return None, None
    try:
        async with SessionLocal() as session:
            pid = (
                await session.execute(select(Product.id).where(Product.code == product_code))
            ).scalar_one_or_none()
            if pid is None:
                raise UnknownProductError(f"product_code={product_code!r} 不存在")
            doc_ids = [
                int(d)
                for d in (
                    await session.execute(
                        select(KbDocument.id).where(KbDocument.product_id == pid)
                    )
                ).scalars().all()
            ]
            return int(pid), doc_ids
    except UnknownProductError:
        raise
    except Exception as e:
        raise RetrievalError(f"DB 查询失败: {e}") from e


async def _hydrate_chunks(chunk_ids: list[int], product_id: int | None) -> tuple[dict, dict]:
    """把 chunk_ids 拉成 (chunk_map, kp_per_chunk)。chunk_map: {chunk_id: (chunk, doc)}。"""
    try:
        async with SessionLocal() as session:
            chunk_stmt = (
                select(KbChunk, KbDocument)
                .join(KbDocument, KbDocument.id == KbChunk.doc_id)
                .where(KbChunk.id.in_(chunk_ids))
            )
            if product_id is not None:
                # 防 TOCTOU：Milvus 检索后、SQL 取详情前，若管理员把某个 doc 改到别的 product，
                # 必须按"当前 DB 里 doc 真实属于的 product_id"再过滤一次。
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
            return chunk_map, kp_per_chunk
    except Exception as e:
        raise RetrievalError(f"DB 查询失败: {e}") from e


async def retrieve_chunks_multi(
    queries: list[str],
    product_code: str | None = None,
    top_k_per: int = 8,
    top_k_total: int = 12,
) -> list[dict]:
    """多 query 并行检索：embed 一次 batch、Milvus 并行 search、合并去重（score=max）。

    - queries 为空或全空 → []
    - product_code 不存在 → UnknownProductError
    - 任一基础设施故障 → RetrievalError
    """
    cleaned = [q.strip() for q in (queries or []) if q and q.strip()]
    # 去重（保持顺序）
    seen: set[str] = set()
    cleaned = [q for q in cleaned if not (q in seen or seen.add(q))]
    if not cleaned:
        return []

    try:
        vecs = await embed(cleaned)
    except Exception as e:
        raise RetrievalError(f"embedding 失败: {e}") from e
    if not vecs or len(vecs) != len(cleaned):
        raise RetrievalError("embedding 返回数量不匹配")

    product_id, product_doc_ids = await _resolve_product_doc_ids(product_code)
    if product_code and product_doc_ids is not None and not product_doc_ids:
        return []

    try:
        hits_per_query = await asyncio.gather(
            *[asyncio.to_thread(milvus_search, v, top_k_per, None, product_doc_ids) for v in vecs]
        )
    except Exception as e:
        raise RetrievalError(f"Milvus 检索失败: {e}") from e

    # 合并：按 chunk_id 取 max score
    merged: dict[int, float] = {}
    for hits in hits_per_query:
        for h in hits or []:
            cid = h["chunk_id"]
            s = float(h.get("score") or 0.0)
            if cid not in merged or merged[cid] < s:
                merged[cid] = s
    if not merged:
        return []

    chunk_map, kp_per_chunk = await _hydrate_chunks(list(merged.keys()), product_id)

    # 按合并 score 降序、截 top_k_total
    ordered_cids = sorted(merged.keys(), key=lambda c: merged[c], reverse=True)
    candidates: list[dict] = []
    for cid in ordered_cids:
        if len(candidates) >= top_k_total:
            break
        pair = chunk_map.get(cid)
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
                "score": merged[cid],
                "doc_id": doc.id,
                "doc_name": doc.file_name,
                "slide_indices": slide_indices,
                "text": chunk.text,
                "kps": kp_per_chunk.get(chunk.id, []),
            }
        )
    return candidates
