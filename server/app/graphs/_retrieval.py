"""检索 + Prompt 防注入工具，供 qa_graph / suggestor_graph 共用。"""
from __future__ import annotations

import asyncio
import re

from sqlalchemy import select

from ..db import (
    KbChunk,
    KbDocument,
    KpCardContent,
    KpChunkLink,
    KpRegistry,
    KpStatus,
    KpTier,
    Product,
    SessionLocal,
)
from ..embeddings import embed
from ..vector_store import search as milvus_search, search_kps as milvus_search_kps


# KP-first 召回参数：每条 query 在 KP 集合里取 top_K_KP 个 KP，每个 KP 最多拉 CHUNKS_PER_KP 个支持 chunk。
# 这两个值故意小：KP 召回是补充路径，主路仍是 chunk-direct；过大反而稀释相关性。
_TOP_K_KP = 8
_CHUNKS_PER_KP = 5


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


async def _kp_first_chunk_hits(
    query_vectors: list[list[float]],
    product_doc_ids: list[int] | None,
) -> list[dict]:
    """对每个 query embedding 在 kp_embeddings 上做 search → 拿到 top KP → 用 SQL 找这些 KP 的支持 chunks
    → 按 product_doc_ids 过滤 → 返回伪 hits {chunk_id, score, doc_id, kp_ids, via_kp, kp_first_score}。

    score 用 KP search 的 cosine 距离作为 chunk 的代理分数（chunks_per_kp 内的 chunk 共享同一 kp_score）。
    后续与 chunk-direct 路径合并时按 chunk_id 取 max；via_kp 字段保留用于 debug / 下游标注。
    """
    if not query_vectors:
        return []
    try:
        kp_hits_per_query = await asyncio.gather(
            *[
                asyncio.to_thread(milvus_search_kps, v, _TOP_K_KP, True)
                for v in query_vectors
            ]
        )
    except Exception as e:
        # KP 路径失败不能阻断整体 RAG（chunk 路径仍可能有结果）
        # 抛 RetrievalError 让上层决定要不要降级，与现有 milvus 失败语义一致
        raise RetrievalError(f"Milvus KP 检索失败: {e}") from e

    # 合并 KP 命中：kp_id → 最高 score
    kp_score: dict[int, float] = {}
    for hits in kp_hits_per_query:
        for h in hits or []:
            kid = int(h["kp_id"])
            s = float(h.get("score") or 0.0)
            if kid not in kp_score or kp_score[kid] < s:
                kp_score[kid] = s
    if not kp_score:
        return []

    # 拉每个 KP 的 top CHUNKS_PER_KP 支持 chunk（按 relevance 降序），并按 product_doc_ids 过滤
    kp_ids = list(kp_score.keys())
    try:
        async with SessionLocal() as session:
            stmt = (
                select(KpChunkLink.kp_id, KpChunkLink.chunk_id, KpChunkLink.relevance, KbChunk.doc_id)
                .join(KbChunk, KbChunk.id == KpChunkLink.chunk_id)
                .where(KpChunkLink.kp_id.in_(kp_ids))
            )
            if product_doc_ids:
                stmt = stmt.where(KbChunk.doc_id.in_(product_doc_ids))
            rows = (await session.execute(stmt)).all()
    except Exception as e:
        raise RetrievalError(f"DB 查询失败: {e}") from e

    # 按 kp_id 分组，截 CHUNKS_PER_KP
    by_kp: dict[int, list[tuple[int, float, int]]] = {}
    for kid, cid, rel, did in rows:
        by_kp.setdefault(int(kid), []).append((int(cid), float(rel or 0.0), int(did)))
    for kid in by_kp:
        by_kp[kid].sort(key=lambda x: x[1], reverse=True)
        by_kp[kid] = by_kp[kid][:_CHUNKS_PER_KP]

    out: list[dict] = []
    for kid, items in by_kp.items():
        base_score = kp_score[kid]
        for cid, _rel, did in items:
            out.append(
                {
                    "chunk_id": cid,
                    "score": base_score,
                    "doc_id": did,
                    "kp_ids": [kid],
                    "via_kp": kid,
                    "kp_first_score": base_score,
                }
            )
    return out


def _merge_hits(*sources: list[dict]) -> list[dict]:
    """按 chunk_id 合并多路 hits：score 取 max，kp_ids 合并去重，保留最高置信的 KP-first 标记。"""
    merged: dict[int, dict] = {}
    for src in sources:
        for h in src or []:
            cid = int(h["chunk_id"])
            cur = merged.get(cid)
            if cur is None:
                merged[cid] = {**h, "kp_ids": list(h.get("kp_ids") or [])}
                continue
            # score 取 max
            if float(h.get("score") or 0.0) > float(cur.get("score") or 0.0):
                cur["score"] = h["score"]
            # 合并 kp_ids
            new_kp_ids = set(cur.get("kp_ids") or [])
            new_kp_ids.update(h.get("kp_ids") or [])
            cur["kp_ids"] = list(new_kp_ids)
            # via_kp / kp_first_score：保留最高 KP-first 分数对应的 KP 标记
            h_kp_score = float(h.get("kp_first_score") or 0.0)
            cur_kp_score = float(cur.get("kp_first_score") or 0.0)
            if h.get("via_kp") and (not cur.get("via_kp") or h_kp_score > cur_kp_score):
                cur["via_kp"] = h["via_kp"]
                cur["kp_first_score"] = h_kp_score
    return list(merged.values())


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

    # KP-first 补充路径：KP 命中后把其挂的支持 chunks 也带进候选池
    try:
        kp_path_hits = await _kp_first_chunk_hits([vecs[0]], product_doc_ids)
    except RetrievalError:
        # KP 路径失败：降级，不阻断主路
        kp_path_hits = []

    hits = _merge_hits(hits, kp_path_hits)
    if not hits:
        return []
    # 合并后按 score 重排序、截 top_k
    hits = sorted(hits, key=lambda h: float(h.get("score") or 0.0), reverse=True)[:top_k]

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
                    select(KpChunkLink, KpRegistry, KpCardContent.tier)
                    .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
                    .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
                    .where(KpChunkLink.chunk_id.in_(chunk_ids))
                    .where(KpRegistry.status == KpStatus.approved)
                )
            ).all()
            kp_per_chunk: dict[int, list[dict]] = {}
            for link, kp, tier in kp_links:
                tier_val = tier.value if hasattr(tier, "value") else (tier or KpTier.detail.value)
                kp_per_chunk.setdefault(link.chunk_id, []).append(
                    {
                        "kp_id": kp.id,
                        "name": kp.name,
                        "link_relevance": float(link.relevance or 0.0),
                        "tier": tier_val,
                    }
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
                "via_kp": h.get("via_kp"),
                "kp_first_score": h.get("kp_first_score"),
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
                    select(KpChunkLink, KpRegistry, KpCardContent.tier)
                    .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
                    .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
                    .where(KpChunkLink.chunk_id.in_(chunk_ids))
                    .where(KpRegistry.status == KpStatus.approved)
                )
            ).all()
            kp_per_chunk: dict[int, list[dict]] = {}
            for link, kp, tier in kp_links:
                tier_val = tier.value if hasattr(tier, "value") else (tier or KpTier.detail.value)
                kp_per_chunk.setdefault(link.chunk_id, []).append(
                    {
                        "kp_id": kp.id,
                        "name": kp.name,
                        "link_relevance": float(link.relevance or 0.0),
                        "tier": tier_val,
                    }
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

    # KP-first 补充路径：对所有 query 一次性走 KP 召回；失败降级（不阻断 chunk-direct 路径）
    try:
        kp_path_hits = await _kp_first_chunk_hits(list(vecs), product_doc_ids)
    except RetrievalError:
        kp_path_hits = []

    # 合并：按 chunk_id 取 max score；同时记录 KP-first 证据给下游使用
    merged: dict[int, float] = {}
    via_kp_map: dict[int, int] = {}
    kp_first_score_map: dict[int, float] = {}
    for hits in hits_per_query:
        for h in hits or []:
            cid = h["chunk_id"]
            s = float(h.get("score") or 0.0)
            if cid not in merged or merged[cid] < s:
                merged[cid] = s
    for h in kp_path_hits:
        cid = h["chunk_id"]
        s = float(h.get("score") or 0.0)
        if cid not in merged or merged[cid] < s:
            merged[cid] = s
        kp_first_score = float(h.get("kp_first_score") or 0.0)
        if h.get("via_kp") and (
            cid not in via_kp_map or kp_first_score > kp_first_score_map.get(cid, 0.0)
        ):
            via_kp_map[cid] = int(h["via_kp"])
            kp_first_score_map[cid] = kp_first_score
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
                "via_kp": via_kp_map.get(cid),
                "kp_first_score": kp_first_score_map.get(cid),
            }
        )
    return candidates


async def fetch_chunks_by_kp_ids(
    kp_ids: list[int],
    product_doc_ids: list[int] | None,
    per_kp_limit: int = 2,
    total_limit: int = 6,
) -> list[dict]:
    """根据明确的 kp_id 列表，直接拉这些 KP 的支持 chunk，按 KpChunkLink.relevance 降序。

    用于 Verifier reflection：当首答漏覆 core KP 时，明确拿这几个 KP 的素材补进 context。
    返回的 dict 与 retrieve_chunks_multi 的 candidate 同 shape（带 kps[].tier）。
    """
    kp_ids = [int(k) for k in (kp_ids or []) if k is not None]
    if not kp_ids:
        return []
    try:
        async with SessionLocal() as session:
            stmt = (
                select(KpChunkLink.kp_id, KpChunkLink.chunk_id, KpChunkLink.relevance)
                .join(KbChunk, KbChunk.id == KpChunkLink.chunk_id)
                .where(KpChunkLink.kp_id.in_(kp_ids))
            )
            if product_doc_ids:
                stmt = stmt.where(KbChunk.doc_id.in_(product_doc_ids))
            rows = (await session.execute(stmt)).all()
    except Exception as e:
        raise RetrievalError(f"DB 查询失败: {e}") from e

    # 按 kp_id 分组，每组按 relevance 降序截 per_kp_limit
    by_kp: dict[int, list[tuple[int, float]]] = {}
    for kid, cid, rel in rows:
        by_kp.setdefault(int(kid), []).append((int(cid), float(rel or 0.0)))
    selected_chunk_ids: list[int] = []
    seen: set[int] = set()
    # round-robin 取，保证多个 KP 都能露脸而不是单个 KP 占满
    cursors = {k: 0 for k in by_kp}
    for v in by_kp.values():
        v.sort(key=lambda x: x[1], reverse=True)
    while len(selected_chunk_ids) < total_limit:
        progressed = False
        for kid in list(by_kp.keys()):
            i = cursors[kid]
            if i >= per_kp_limit or i >= len(by_kp[kid]):
                continue
            cid, _rel = by_kp[kid][i]
            cursors[kid] += 1
            progressed = True
            if cid in seen:
                continue
            seen.add(cid)
            selected_chunk_ids.append(cid)
            if len(selected_chunk_ids) >= total_limit:
                break
        if not progressed:
            break

    if not selected_chunk_ids:
        return []

    # 复用 _hydrate_chunks 拉详情 + KP 列表（带 tier）；product_id=None：已通过 product_doc_ids 过滤
    chunk_map, kp_per_chunk = await _hydrate_chunks(selected_chunk_ids, product_id=None)

    out: list[dict] = []
    for cid in selected_chunk_ids:
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
        out.append(
            {
                "chunk_id": chunk.id,
                "score": 0.0,  # 非 embedding 检索而来，置 0；下游不依赖该值
                "doc_id": doc.id,
                "doc_name": doc.file_name,
                "slide_indices": slide_indices,
                "text": chunk.text,
                "kps": kp_per_chunk.get(chunk.id, []),
                "via_kp": next((k for k, v in by_kp.items() if any(c == chunk.id for c, _ in v)), None),
                "kp_first_score": None,
                "rerank_score": None,  # 不参与 rerank，保留字段供下游一致访问
            }
        )
    return out
