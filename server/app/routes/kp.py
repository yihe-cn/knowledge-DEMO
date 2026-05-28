"""KP Registry admin 接口。仅 internal 使用，不做鉴权（MVP）。"""
from __future__ import annotations

from typing import Any

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime

from ..db import (
    EnrichStatus,
    ExamStatus,
    KbChunk,
    KbDocument,
    KpCardContent,
    KpChunkLink,
    KpExtractionJob,
    KpProductLink,
    KpRegistry,
    KpStatus,
    KpTier,
    LinkSource,
    Product,
    ProductKp,
    ProductLinkSource,
    get_session,
)
from ..schemas import (
    KpBulkIdsRequest,
    KpCardUpdateIn,
    KpExamUpdateIn,
    KpLinkRequest,
    KpMergeRequest,
    KpProductBindRequest,
    KpReindexBatchRequest,
)
from ..config import settings
from ..vector_store import update_kp_ids


# 状态切换、merge、delete、card 编辑后触发 KP 索引同步。
# 失败时 reindex_kp_sync 自己已把状态写到 card.retrieval_index_status=failed + error；
# 这里返回 {ok, error?} 让调用方可以把 warning 带回响应给前端。
async def _async_reindex_kp(kp_id: int) -> dict:
    from ..kp_extraction.kp_indexer import reindex_kp_sync  # 局部导入避免循环

    try:
        return await asyncio.to_thread(reindex_kp_sync, kp_id)
    except Exception as e:  # noqa: BLE001
        # to_thread 包装层异常（reindex_kp_sync 本身不抛）：写状态兜底
        from ..kp_extraction.kp_indexer import _write_index_failure  # noqa: WPS433
        await asyncio.to_thread(_write_index_failure, kp_id, repr(e)[:500])
        return {"ok": False, "kp_id": kp_id, "error": repr(e)[:500]}


async def _async_delete_kp_index(kp_id: int) -> dict:
    from ..kp_extraction.kp_indexer import delete_kp_index  # 局部导入

    try:
        return await asyncio.to_thread(delete_kp_index, kp_id)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "kp_id": kp_id, "error": repr(e)[:500]}


def _reindex_warning(res: dict | None) -> str:
    """从 reindex 结果里抽错误信息；skipped 不算 warning。"""
    if not res or res.get("ok"):
        return ""
    return str(res.get("error") or "reindex failed")[:300]


router = APIRouter()


def _card_to_out(card: KpCardContent | None) -> dict[str, Any]:
    """KpCardContent → 前端 camelCase 字典。None 时返回 pending 占位。"""
    if card is None:
        return {
            "tier": "detail",
            "spec": "",
            "customerVoice": "",
            "sources": [],
            "appliesTo": [],
            "notApplicable": [],
            "rebuttals": [],
            "sales": "",
            "triggerQuestions": [],
            "aliases": [],
            "scenario": "",
            "retrievalIndexedAt": None,
            "retrievalIndexStatus": "pending",
            "retrievalIndexError": "",
            "enrichStatus": "pending",
            "enrichError": "",
            "enrichedAt": None,
            "examQuestion": "",
            "examRubric": [],
            "examStatus": "pending",
            "examGeneratedAt": None,
            "examError": "",
        }
    tier = card.tier.value if hasattr(card.tier, "value") else str(card.tier)
    status = (
        card.enrich_status.value
        if hasattr(card.enrich_status, "value")
        else str(card.enrich_status)
    )
    exam_status = (
        card.exam_status.value
        if hasattr(card.exam_status, "value")
        else str(card.exam_status)
    )
    ri_status = (
        card.retrieval_index_status.value
        if hasattr(card.retrieval_index_status, "value")
        else str(card.retrieval_index_status)
    )
    return {
        "tier": tier,
        "spec": card.spec or "",
        "customerVoice": card.customer_voice or "",
        "sources": list(card.sources or []),
        "appliesTo": list(card.applies_to or []),
        "notApplicable": list(card.not_applicable or []),
        "rebuttals": list(card.rebuttals or []),
        "sales": card.sales or "",
        "triggerQuestions": list(card.trigger_questions or []),
        "aliases": list(card.aliases or []),
        "scenario": card.scenario or "",
        "retrievalIndexedAt": card.retrieval_indexed_at.isoformat() if card.retrieval_indexed_at else None,
        "retrievalIndexStatus": ri_status,
        "retrievalIndexError": card.retrieval_index_error or "",
        "enrichStatus": status,
        "enrichError": card.enrich_error or "",
        "enrichedAt": card.enriched_at.isoformat() if card.enriched_at else None,
        "examQuestion": card.exam_question or "",
        "examRubric": list(card.exam_rubric or []),
        "examStatus": exam_status,
        "examGeneratedAt": card.exam_generated_at.isoformat() if card.exam_generated_at else None,
        "examError": card.exam_error or "",
    }


class KpOut(BaseModel):
    id: int
    name: str
    definition: str
    category: str
    status: str
    version: int

    @classmethod
    def from_orm_kp(cls, kp: KpRegistry) -> "KpOut":
        return cls(
            id=kp.id,
            name=kp.name,
            definition=kp.definition,
            category=kp.category,
            status=kp.status.value if hasattr(kp.status, "value") else str(kp.status),
            version=kp.version,
        )


class KpCreate(BaseModel):
    name: str
    definition: str = ""
    category: str = ""


class KpPatch(BaseModel):
    name: str | None = None
    definition: str | None = None
    category: str | None = None
    status: str | None = None  # draft / approved / archived


@router.get("/kp")
async def list_kps(
    status: str | None = Query(None),
    product_id: int | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = select(KpRegistry).order_by(KpRegistry.id.desc()).offset(offset).limit(limit)
    if status:
        stmt = stmt.where(KpRegistry.status == status)
    if product_id is not None:
        link_ids = set(
            (await session.execute(
                select(KpProductLink.kp_id).where(KpProductLink.product_id == product_id)
            )).scalars().all()
        )
        curriculum_ids = set(
            (await session.execute(
                select(ProductKp.kp_id).where(ProductKp.product_id == product_id)
            )).scalars().all()
        )
        kp_ids = link_ids | curriculum_ids
        if not kp_ids:
            return {"items": []}
        stmt = stmt.where(KpRegistry.id.in_(kp_ids))
    rows = (await session.execute(stmt)).scalars().all()
    # 附加 chunk_count：考核出题需要素材，0 chunks 的 KP 选了也只能用 definition 兜底，
    # 前端要据此提示/禁用。一次性聚合查询，避免 N+1。
    kp_ids = [r.id for r in rows]
    counts: dict[int, int] = {}
    exam_status_map: dict[int, str] = {}
    curriculum_status_map: dict[int, str] = {}
    if kp_ids:
        from sqlalchemy import func as _func
        cc = await session.execute(
            select(KpChunkLink.kp_id, _func.count(KpChunkLink.id))
            .where(KpChunkLink.kp_id.in_(kp_ids))
            .group_by(KpChunkLink.kp_id)
        )
        counts = {int(k): int(c) for k, c in cc.all()}

        exam_rows = await session.execute(
            select(KpCardContent.kp_id, KpCardContent.exam_status)
            .where(KpCardContent.kp_id.in_(kp_ids))
        )
        for kid, st in exam_rows.all():
            exam_status_map[int(kid)] = st.value if hasattr(st, "value") else str(st)
        if product_id is not None:
            curriculum_rows = await session.execute(
                select(ProductKp.kp_id, ProductKp.removed_at)
                .where(ProductKp.product_id == product_id)
                .where(ProductKp.kp_id.in_(kp_ids))
            )
            for kid, removed_at in curriculum_rows.all():
                curriculum_status_map[int(kid)] = (
                    "removed" if removed_at is not None else "active"
                )
    items: list[dict[str, Any]] = []
    for r in rows:
        d = KpOut.from_orm_kp(r).model_dump()
        d["chunk_count"] = counts.get(r.id, 0)
        d["exam_status"] = exam_status_map.get(r.id, "pending")
        if product_id is not None:
            d["curriculum_status"] = curriculum_status_map.get(r.id, "not_in_course")
        items.append(d)
    return {"items": items}


@router.get("/kp/{kp_id}")
async def get_kp(kp_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    links = (
        await session.execute(select(KpChunkLink).where(KpChunkLink.kp_id == kp_id))
    ).scalars().all()
    products = (
        await session.execute(
            select(Product, KpProductLink.source)
            .join(KpProductLink, KpProductLink.product_id == Product.id)
            .where(KpProductLink.kp_id == kp_id)
        )
    ).all()
    card = (
        await session.execute(
            select(KpCardContent).where(KpCardContent.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    return {
        **KpOut.from_orm_kp(kp).model_dump(),
        "chunk_links": [
            {"chunk_id": l.chunk_id, "relevance": l.relevance, "source": l.source.value if hasattr(l.source, "value") else str(l.source)}
            for l in links
        ],
        "products": [
            {
                "id": p.id,
                "code": p.code,
                "name": p.name,
                "source": s.value if hasattr(s, "value") else str(s),
            }
            for p, s in products
        ],
        "card": _card_to_out(card),
    }


@router.post("/kp")
async def create_kp(body: KpCreate, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    kp = KpRegistry(name=body.name, definition=body.definition, category=body.category, created_by="manual")
    session.add(kp)
    await session.commit()
    await session.refresh(kp)
    return KpOut.from_orm_kp(kp).model_dump()


@router.patch("/kp/{kp_id}")
async def patch_kp(
    kp_id: int, body: KpPatch, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    status_changed = False
    if body.name is not None:
        kp.name = body.name
    if body.definition is not None:
        kp.definition = body.definition
    if body.category is not None:
        kp.category = body.category
    if body.status is not None:
        if body.status not in {s.value for s in KpStatus}:
            raise HTTPException(400, f"bad status {body.status}")
        new_status = KpStatus(body.status)
        status_changed = kp.status != new_status
        kp.status = new_status
    await session.commit()
    await session.refresh(kp)

    # 状态从 approved → 其他（archived / draft），要把该 KP 从 Milvus kp_ids 里清掉
    # _rewrite_chunks_in_milvus 会重算 approved 集合，自动剔除当前 KP
    if status_changed and kp.status != KpStatus.approved:
        chunk_ids = (
            await session.execute(
                select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id == kp_id).distinct()
            )
        ).scalars().all()
        await _rewrite_chunks_in_milvus(session, [int(c) for c in chunk_ids])
    # 反向：draft → approved 的情况由 approve_kp 处理；走 patch 改 approved 也补一次
    elif status_changed and kp.status == KpStatus.approved:
        chunk_ids = (
            await session.execute(
                select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id == kp_id).distinct()
            )
        ).scalars().all()
        await _rewrite_chunks_in_milvus(session, [int(c) for c in chunk_ids])

    # name/definition 变更或 status 变更都需要重建 KP 索引：前者影响向量文本，后者影响 status flag
    reindex_warning = ""
    if status_changed or body.name is not None or body.definition is not None:
        res = await _async_reindex_kp(kp_id)
        reindex_warning = _reindex_warning(res)

    payload = KpOut.from_orm_kp(kp).model_dump()
    if reindex_warning:
        payload["reindex_warning"] = reindex_warning
    return payload


@router.delete("/kp/{kp_id}")
async def delete_kp(kp_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """硬删除 KP：级联清理 MySQL 关联表，并同步重写 Milvus 中 chunk 的 kp_ids 数组。

    返回 milvus_error 字段（非空表示 DB 已删但 Milvus 同步失败，需手工 reconcile）。
    """
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")

    # 先收集关联 chunk_ids，DB 删除后这些 link 会被级联清掉
    chunk_ids = (
        await session.execute(
            select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id == kp_id).distinct()
        )
    ).scalars().all()
    chunk_ids = [int(c) for c in chunk_ids]

    # MySQL 删除：KpChunkLink / KpProductLink / KpCardContent 走 ondelete=CASCADE
    await session.delete(kp)
    await session.commit()

    # Milvus 同步：KP 行已不存在，_rewrite 内部 join approved 过滤后会自动剔除该 id
    rewritten = 0
    milvus_error = ""
    if chunk_ids:
        try:
            rewritten = await _rewrite_chunks_in_milvus(session, chunk_ids)
        except HTTPException as e:
            milvus_error = str(e.detail)[:200]

    # KP 自身向量也要清掉
    await _async_delete_kp_index(kp_id)

    return {
        "ok": not milvus_error,
        "kp_id": kp_id,
        "milvus_rewritten_chunks": rewritten,
        "chunk_count": len(chunk_ids),
        "milvus_error": milvus_error,
    }


@router.post("/kp/bulk-delete")
async def bulk_delete_kps(
    body: KpBulkIdsRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """批量硬删除：一次性收集所有受影响 chunk，统一回写 Milvus（避免逐条删除时
    对共享 chunk 重复回写多次）。

    注意：MySQL commit 与 Milvus 回写不是原子的。Milvus 失败时返回 milvus_error，
    需要后续人工或后台任务 reconcile。
    """
    requested_ids = list(dict.fromkeys(body.kp_ids))  # 去重保序
    if not requested_ids:
        return {
            "ok": True,
            "deleted_count": 0,
            "skipped_already_missing": [],
            "milvus_rewritten_chunks": 0,
            "chunk_count": 0,
            "milvus_error": "",
        }

    existing_ids = list(
        (
            await session.execute(
                select(KpRegistry.id).where(KpRegistry.id.in_(requested_ids))
            )
        ).scalars().all()
    )
    existing_id_set = set(existing_ids)
    missing = [i for i in requested_ids if i not in existing_id_set]

    chunk_ids = [
        int(c)
        for c in (
            await session.execute(
                select(KpChunkLink.chunk_id)
                .where(KpChunkLink.kp_id.in_(existing_ids))
                .distinct()
            )
        ).scalars().all()
    ]

    deleted_count = 0
    if existing_ids:
        # 用单条 DELETE 取 rowcount 作为真实删除数（并发下不会被同事务的内存对象误算）。
        # KpChunkLink / KpProductLink / KpCardContent 全部已在 DB 侧配 ondelete=CASCADE，
        # 不依赖 ORM relationship cascade。
        result = await session.execute(
            sa_delete(KpRegistry).where(KpRegistry.id.in_(existing_ids))
        )
        await session.commit()
        deleted_count = int(result.rowcount or 0)

    rewritten = 0
    milvus_error = ""
    if chunk_ids:
        try:
            rewritten = await _rewrite_chunks_in_milvus(session, chunk_ids)
        except HTTPException as e:
            milvus_error = str(e.detail)[:200]

    # 已删除的 KP 自身向量也要清掉
    for kid in existing_ids:
        await _async_delete_kp_index(int(kid))

    return {
        "ok": not milvus_error,
        "deleted_count": deleted_count,
        "skipped_already_missing": missing,
        "milvus_rewritten_chunks": rewritten,
        "chunk_count": len(chunk_ids),
        "milvus_error": milvus_error,
    }


@router.post("/kp/bulk-archive")
async def bulk_archive_kps(
    body: KpBulkIdsRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """批量归档：只把 status != archived 的 KP 改为 archived，并按真实变更回写 Milvus。

    返回 archived（实际改动数）/ skipped_already_archived / missing_ids。
    """
    requested_ids = list(dict.fromkeys(body.kp_ids))
    if not requested_ids:
        return {
            "ok": True,
            "archived": 0,
            "skipped_already_archived": [],
            "missing_ids": [],
            "milvus_rewritten_chunks": 0,
            "milvus_error": "",
        }

    rows = (
        await session.execute(
            select(KpRegistry.id, KpRegistry.status).where(KpRegistry.id.in_(requested_ids))
        )
    ).all()
    by_status: dict[KpStatus, list[int]] = {}
    for kid, st in rows:
        by_status.setdefault(st, []).append(int(kid))
    existing_ids = {kid for ids in by_status.values() for kid in ids}
    missing = [i for i in requested_ids if i not in existing_ids]
    already_archived = by_status.get(KpStatus.archived, [])
    to_archive = [kid for st, ids in by_status.items() if st != KpStatus.archived for kid in ids]

    archived_real = 0
    if to_archive:
        result = await session.execute(
            update(KpRegistry).where(KpRegistry.id.in_(to_archive)).values(status=KpStatus.archived)
        )
        await session.commit()
        archived_real = int(result.rowcount or 0)

    # 只对状态真正变化的 KP 关联的 chunk 回写
    chunk_ids = [
        int(c)
        for c in (
            await session.execute(
                select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id.in_(to_archive)).distinct()
            )
        ).scalars().all()
    ] if to_archive else []

    rewritten = 0
    milvus_error = ""
    if chunk_ids:
        try:
            rewritten = await _rewrite_chunks_in_milvus(session, chunk_ids)
        except HTTPException as e:
            milvus_error = str(e.detail)[:200]

    # archive 后 KP 的 status flag 切 0，重建索引让其退出召回
    reindex_failures: list[dict[str, Any]] = []
    for kid in to_archive:
        res = await _async_reindex_kp(int(kid))
        if res and not res.get("ok"):
            reindex_failures.append({"kp_id": int(kid), "error": str(res.get("error") or "")[:300]})

    return {
        "ok": not milvus_error and not reindex_failures,
        "archived": archived_real,
        "skipped_already_archived": already_archived,
        "missing_ids": missing,
        "milvus_rewritten_chunks": rewritten,
        "milvus_error": milvus_error,
        "reindex_failures": reindex_failures,
    }


@router.post("/kp/{kp_id}/approve")
async def approve_kp(kp_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """approve 时把 kp_id 回写到所有关联 chunk 的 Milvus kp_ids 字段。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    kp.status = KpStatus.approved
    await session.commit()

    chunk_ids = (
        await session.execute(
            select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id == kp_id).distinct()
        )
    ).scalars().all()
    rewritten = await _rewrite_chunks_in_milvus(session, [int(c) for c in chunk_ids])
    # approve 状态切换后同步 KP 索引（status flag 从 0 → 1，让该 KP 进入召回）
    reindex_res = await _async_reindex_kp(kp_id)
    return {
        "ok": True,
        "rewritten_chunks": rewritten,
        "reindex_warning": _reindex_warning(reindex_res),
    }


async def _rewrite_chunks_in_milvus(session: AsyncSession, chunk_ids: list[int]) -> int:
    """对给定 chunk_ids 重新计算其 approved KP 集合，批量回写 Milvus；
    单 chunk 写入失败带 2 次重试；最终仍有失败时抛 HTTPException 500（MySQL 已 commit，前端会看到 503-like 错误，
    需要管理员手工触发 reconcile）。返回成功处理数。
    """
    if not chunk_ids:
        return 0
    rows = (
        await session.execute(
            select(KpChunkLink.chunk_id, KpChunkLink.kp_id)
            .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
            .where(KpChunkLink.chunk_id.in_(chunk_ids))
            .where(KpRegistry.status == KpStatus.approved)
        )
    ).all()
    grouped: dict[int, list[int]] = {int(cid): [] for cid in chunk_ids}
    for cid, kid in rows:
        grouped.setdefault(int(cid), []).append(int(kid))

    # pymilvus client 是同步阻塞的，全部丢线程池避免堵 event loop
    def _rewrite_one(cid: int, ids: list[int]) -> tuple[bool, str]:
        last_err: Exception | None = None
        for _ in range(3):  # 1 + 2 retry
            try:
                update_kp_ids(cid, ids)
                return True, ""
            except Exception as e:
                last_err = e
        return False, repr(last_err)[:200]

    failed: list[tuple[int, str]] = []
    success = 0
    for cid, ids in grouped.items():
        ok, err = await asyncio.to_thread(_rewrite_one, cid, ids)
        if ok:
            success += 1
        else:
            failed.append((cid, err))

    if failed:
        sample = failed[:5]
        raise HTTPException(
            500,
            f"Milvus 回写失败 {len(failed)}/{len(grouped)} 个 chunk。"
            f"MySQL 已写入，需手工 reconcile。样本: {sample}",
        )
    return success


@router.post("/kp/bulk-approve")
async def bulk_approve(
    body: KpBulkIdsRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """批量发布：只把 draft → approved。已是 approved 的跳过；archived 被拒绝
    （要重新发布必须先编辑改回 draft）。返回真实改动数与跳过明细。
    """
    requested_ids = list(dict.fromkeys(body.kp_ids))
    if not requested_ids:
        return {
            "ok": True,
            "approved": 0,
            "skipped_already_approved": [],
            "skipped_archived": [],
            "missing_ids": [],
            "rewritten_chunks": 0,
            "milvus_error": "",
        }

    rows = (
        await session.execute(
            select(KpRegistry.id, KpRegistry.status).where(KpRegistry.id.in_(requested_ids))
        )
    ).all()
    by_status: dict[KpStatus, list[int]] = {}
    for kid, st in rows:
        by_status.setdefault(st, []).append(int(kid))
    existing_ids = {kid for ids in by_status.values() for kid in ids}
    missing = [i for i in requested_ids if i not in existing_ids]
    already_approved = by_status.get(KpStatus.approved, [])
    skipped_archived = by_status.get(KpStatus.archived, [])
    to_approve = by_status.get(KpStatus.draft, [])

    approved_real = 0
    if to_approve:
        result = await session.execute(
            update(KpRegistry).where(KpRegistry.id.in_(to_approve)).values(status=KpStatus.approved)
        )
        await session.commit()
        approved_real = int(result.rowcount or 0)

    # 只对状态真正变化的 KP 回写 Milvus
    rewritten = 0
    milvus_error = ""
    if to_approve:
        chunk_ids = [
            int(c)
            for c in (
                await session.execute(
                    select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id.in_(to_approve)).distinct()
                )
            ).scalars().all()
        ]
        if chunk_ids:
            try:
                rewritten = await _rewrite_chunks_in_milvus(session, chunk_ids)
            except HTTPException as e:
                milvus_error = str(e.detail)[:200]

    # 批量 approve 后，把真正改动的 KP 同步进 KP 索引（status flag 0 → 1）
    reindex_failures: list[dict[str, Any]] = []
    for kid in to_approve:
        res = await _async_reindex_kp(int(kid))
        if res and not res.get("ok"):
            reindex_failures.append({"kp_id": int(kid), "error": str(res.get("error") or "")[:300]})

    return {
        "ok": not milvus_error and not reindex_failures,
        "approved": approved_real,
        "skipped_already_approved": already_approved,
        "skipped_archived": skipped_archived,
        "missing_ids": missing,
        "rewritten_chunks": rewritten,
        "milvus_error": milvus_error,
        "reindex_failures": reindex_failures,
    }


@router.post("/kp/{kp_id}/merge")
async def merge_kp(
    kp_id: int, body: KpMergeRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """把 source_kp_id 的所有 chunk_link 迁到 kp_id，源 KP 归档，写回 Milvus。"""
    if body.source_kp_id == kp_id:
        raise HTTPException(400, "source 与目标 KP 相同")
    target = await session.get(KpRegistry, kp_id)
    source = await session.get(KpRegistry, body.source_kp_id)
    if not target or not source:
        raise HTTPException(404, "kp not found")

    # 合并的语义是"用 target 替代 source 出现在 Milvus 检索结果里"。
    # 如果 source 已 approved，但 target 还是 draft/archived，回写后这些 chunk
    # 的 approved KP 集合会被清空——前端 tagged_kps 会无故消失。直接禁掉。
    if source.status == KpStatus.approved and target.status != KpStatus.approved:
        raise HTTPException(
            400,
            f"source(KP {source.id}) 是 approved，但 target(KP {target.id}) 状态={target.status.value}，"
            f"合并会让相关 chunk 的 approved KP 标注清空。请先把 target approve 再合并。",
        )

    src_chunk_ids = (
        await session.execute(
            select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id == body.source_kp_id)
        )
    ).scalars().all()
    src_chunk_ids = [int(c) for c in src_chunk_ids]

    existing_target_chunks = set(
        (
            await session.execute(
                select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id == kp_id)
            )
        ).scalars().all()
    )

    migrated = 0
    for cid in src_chunk_ids:
        if cid in existing_target_chunks:
            continue
        session.add(
            KpChunkLink(kp_id=kp_id, chunk_id=cid, relevance=1.0, source=LinkSource.manual)
        )
        migrated += 1

    # 删源 KP 的 link，源 KP archive
    await session.execute(
        KpChunkLink.__table__.delete().where(KpChunkLink.kp_id == body.source_kp_id)
    )
    source.status = KpStatus.archived
    await session.commit()

    # 回写所有受影响 chunk 的 approved kp_id 集合
    rewritten = await _rewrite_chunks_in_milvus(session, src_chunk_ids)

    # KP 索引：source 归档（status 0），target 因吸纳了新 link 不影响向量文本（向量是名/定义/富字段拼成），
    # 但保险起见也重建一次。
    await _async_reindex_kp(body.source_kp_id)
    await _async_reindex_kp(kp_id)

    return {
        "ok": True,
        "migrated_links": migrated,
        "archived_kp": body.source_kp_id,
        "rewritten_chunks": rewritten,
    }


@router.post("/kp/{kp_id}/link")
async def link_chunk(
    kp_id: int, body: KpLinkRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    chunk = await session.get(KbChunk, body.chunk_id)
    if not chunk:
        raise HTTPException(404, "chunk not found")
    existing = (
        await session.execute(
            select(KpChunkLink)
            .where(KpChunkLink.kp_id == kp_id)
            .where(KpChunkLink.chunk_id == body.chunk_id)
        )
    ).scalar_one_or_none()
    if existing:
        existing.relevance = body.relevance
        existing.source = LinkSource.manual
    else:
        session.add(
            KpChunkLink(
                kp_id=kp_id,
                chunk_id=body.chunk_id,
                relevance=body.relevance,
                source=LinkSource.manual,
            )
        )
    await session.commit()
    await _rewrite_chunks_in_milvus(session, [body.chunk_id])
    return {"ok": True}


@router.delete("/kp/{kp_id}/link/{chunk_id}")
async def unlink_chunk(
    kp_id: int, chunk_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    await session.execute(
        KpChunkLink.__table__.delete()
        .where(KpChunkLink.kp_id == kp_id)
        .where(KpChunkLink.chunk_id == chunk_id)
    )
    await session.commit()
    await _rewrite_chunks_in_milvus(session, [chunk_id])
    return {"ok": True}


@router.get("/kp/{kp_id}/chunks")
async def list_kp_chunks(
    kp_id: int,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    rows = (
        await session.execute(
            select(KpChunkLink, KbChunk, KbDocument)
            .join(KbChunk, KbChunk.id == KpChunkLink.chunk_id)
            .join(KbDocument, KbDocument.id == KbChunk.doc_id)
            .where(KpChunkLink.kp_id == kp_id)
            .order_by(desc(KpChunkLink.relevance), KpChunkLink.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {
        "items": [
            {
                "link_id": link.id,
                "chunk_id": chunk.id,
                "chunk_index": chunk.chunk_index,
                "text": chunk.text,
                "meta": chunk.meta or {},
                "relevance": link.relevance,
                "source": link.source.value if hasattr(link.source, "value") else str(link.source),
                "doc_id": doc.id,
                "doc_name": doc.file_name,
            }
            for link, chunk, doc in rows
        ]
    }


@router.get("/kp-extraction-jobs")
async def list_extraction_jobs(
    doc_id: int | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = (
        select(KpExtractionJob, KbDocument.file_name)
        .join(KbDocument, KbDocument.id == KpExtractionJob.doc_id)
        .order_by(desc(KpExtractionJob.id))
        .offset(offset)
        .limit(limit)
    )
    if doc_id is not None:
        stmt = stmt.where(KpExtractionJob.doc_id == doc_id)
    if status:
        stmt = stmt.where(KpExtractionJob.status == status)
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": job.id,
                "doc_id": job.doc_id,
                "doc_name": doc_name,
                "status": job.status,
                "candidate_count": job.candidate_count,
                "new_kp_count": job.new_kp_count,
                "error": job.error or "",
                "created_at": job.created_at.isoformat() if job.created_at else "",
                "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            }
            for job, doc_name in rows
        ]
    }


async def _sync_product_kp_for_kp(
    session: AsyncSession, *, kp_id: int, active_product_ids: set[int]
) -> None:
    """同步 ProductKp 课程编排，让 admin 的 KP↔Product 绑定改动立即对学员侧学习屏生效。

    - product_id 在 active_product_ids 里：upsert ProductKp（复活软删的，新增的追加到队尾）。
    - product_id 不在：软删 ProductKp（保留学员历史进度可追溯）。

    专门为 KP→产品方向的写入设计，假设调用方刚刚改完 KpProductLink，
    KpDetail 的"绑定产品"流程才会自动让 KP 出现在 swipe 学习里。
    """
    rows = (
        await session.execute(
            select(ProductKp).where(ProductKp.kp_id == kp_id)
        )
    ).scalars().all()
    by_pid: dict[int, ProductKp] = {r.product_id: r for r in rows}

    now = datetime.utcnow()
    # 软删除不再绑定的
    for r in rows:
        if r.product_id not in active_product_ids and r.removed_at is None:
            r.removed_at = now

    # 复活/新增
    for pid in active_product_ids:
        existing = by_pid.get(pid)
        if existing is None:
            # 算 order_index = 该 product 当前 active 数量（追加到队尾）
            cnt = (
                await session.execute(
                    select(func.count(ProductKp.id))
                    .where(ProductKp.product_id == pid)
                    .where(ProductKp.removed_at.is_(None))
                )
            ).scalar_one()
            session.add(
                ProductKp(product_id=pid, kp_id=kp_id, order_index=int(cnt or 0))
            )
        elif existing.removed_at is not None:
            existing.removed_at = None


@router.post("/kp/{kp_id}/products")
async def bind_kp_products(
    kp_id: int, body: KpProductBindRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """全量替换 KP 的产品绑定。manual 来源。同时同步 ProductKp 课程编排。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    new_pids = set(body.product_ids)
    # 清掉旧的，全部以新的为准
    await session.execute(
        KpProductLink.__table__.delete().where(KpProductLink.kp_id == kp_id)
    )
    for pid in new_pids:
        session.add(
            KpProductLink(kp_id=kp_id, product_id=pid, source=ProductLinkSource.manual)
        )
    await _sync_product_kp_for_kp(session, kp_id=kp_id, active_product_ids=new_pids)
    await session.commit()
    return {"ok": True, "product_ids": list(new_pids)}


@router.post("/kp/{kp_id}/products/{product_id}")
async def add_kp_product(
    kp_id: int, product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """给 KP 增加一个产品/课程绑定，不影响其已有跨产品绑定。同步 ProductKp 课程编排。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    product = await session.get(Product, product_id)
    if not product:
        raise HTTPException(404, "product not found")
    existing = (
        await session.execute(
            select(KpProductLink)
            .where(KpProductLink.kp_id == kp_id)
            .where(KpProductLink.product_id == product_id)
        )
    ).scalar_one_or_none()
    if not existing:
        session.add(
            KpProductLink(
                kp_id=kp_id,
                product_id=product_id,
                source=ProductLinkSource.manual,
            )
        )

    # ProductKp 增量同步：保证 KP 立即出现在该 product 的 swipe 学习里
    pk = (
        await session.execute(
            select(ProductKp)
            .where(ProductKp.kp_id == kp_id)
            .where(ProductKp.product_id == product_id)
        )
    ).scalar_one_or_none()
    if pk is None:
        cnt = (
            await session.execute(
                select(func.count(ProductKp.id))
                .where(ProductKp.product_id == product_id)
                .where(ProductKp.removed_at.is_(None))
            )
        ).scalar_one()
        session.add(
            ProductKp(product_id=product_id, kp_id=kp_id, order_index=int(cnt or 0))
        )
    elif pk.removed_at is not None:
        pk.removed_at = None

    await session.commit()
    return {"ok": True, "kp_id": kp_id, "product_id": product_id}


@router.post("/kp/{kp_id}/enrich")
async def enrich_kp(kp_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """手动触发 Pass-2 enrich：重新喂 LLM 填富字段。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    from ..kp_extraction.enricher import enrich_kp_sync  # 局部导入避免循环

    result = await asyncio.to_thread(enrich_kp_sync, kp_id)
    return result


@router.post("/kp/enrich-pending")
async def enrich_pending_kps(
    product_id: int | None = Query(None, description="限定某产品；不传则对所有产品"),
    only_failed: bool = Query(False, description="只重试 failed，跳过 pending"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """批量 enrich 状态为 pending（或 failed）的 KP。在后台线程依次执行，不阻塞。
    返回触发的 kp_id 列表；实际结果可通过 GET /kp?status=approved 或 KpDetail 查看。
    """
    from ..kp_extraction.enricher import enrich_kp_sync  # 局部导入避免循环

    target_statuses = [EnrichStatus.failed] if only_failed else [EnrichStatus.pending, EnrichStatus.failed]

    # 找出所有 approved KP 中 card 缺失 或 enrich_status in target_statuses 的
    stmt = (
        select(KpRegistry.id)
        .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
        .where(KpRegistry.status == KpStatus.approved)
        .where(
            (KpCardContent.kp_id.is_(None)) |
            (KpCardContent.enrich_status.in_(target_statuses))
        )
        .order_by(KpRegistry.id)
    )
    if product_id is not None:
        stmt = stmt.join(KpProductLink, KpProductLink.kp_id == KpRegistry.id).where(
            KpProductLink.product_id == product_id
        )

    kp_ids = list((await session.execute(stmt)).scalars().all())
    if not kp_ids:
        return {"ok": True, "triggered": 0, "kp_ids": []}

    async def _run_all():
        done, failed = 0, 0
        for kid in kp_ids:
            try:
                await asyncio.to_thread(enrich_kp_sync, kid)
                done += 1
            except Exception:
                failed += 1

    asyncio.create_task(_run_all())
    return {"ok": True, "triggered": len(kp_ids), "kp_ids": kp_ids}


@router.post("/kp/reindex-batch")
async def reindex_kps_batch(body: KpReindexBatchRequest) -> dict[str, Any]:
    """批量重建 KP 召回索引。kp_ids 为空时默认全部 approved KP；
    reenrich=True 时每个 KP 先调 LLM 重生成 trigger_questions/aliases/scenario 再 reindex。
    默认在 FastAPI 进程内执行；Milvus Lite 不适合多个进程同时写同一个 .db 文件。
    显式设置 CELERY_ENABLED=true 时才走 Celery 异步执行。

    Celery/Redis 不可用时返回结构化错误而不是 500。
    """
    if not settings.celery_enabled:
        from ..kp_extraction.kp_indexer import reindex_kps_batch_sync

        result = await asyncio.to_thread(
            reindex_kps_batch_sync, body.kp_ids, body.reenrich
        )
        return {
            "ok": bool(result.get("ok", True)),
            "mode": "inline",
            "task_id": None,
            "kp_ids": body.kp_ids,
            "reenrich": body.reenrich,
            "result": result,
        }

    from ..celery_app import reindex_kps_batch_task

    try:
        async_res = reindex_kps_batch_task.delay(body.kp_ids, body.reenrich)
    except Exception as e:  # noqa: BLE001 — Celery/Redis 派发故障要兜住
        return {
            "ok": False,
            "task_id": None,
            "dispatch_error": f"派发 Celery 任务失败：{type(e).__name__}: {e}"[:300],
            "kp_ids": body.kp_ids,
            "reenrich": body.reenrich,
        }
    return {
        "ok": True,
        "task_id": async_res.id,
        "kp_ids": body.kp_ids,
        "reenrich": body.reenrich,
    }


@router.get("/kp/reindex-batch/{task_id}")
async def get_reindex_kps_batch_task(task_id: str) -> dict[str, Any]:
    """查询批量 KP 索引任务进度。"""
    try:
        from ..celery_app import celery_app

        async_res = celery_app.AsyncResult(task_id)
        state = async_res.state
        raw_info = async_res.info
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "task_id": task_id,
            "state": "UNKNOWN",
            "error": f"查询 Celery 任务失败：{type(e).__name__}: {e}"[:300],
            "done": True,
        }

    info = raw_info if isinstance(raw_info, dict) else {}
    result = info if state == "SUCCESS" else None

    if state == "SUCCESS":
        total = int(info.get("total_steps") or info.get("total") or 0)
        current = total
        stage = "completed"
    else:
        total = int(info.get("total") or 0)
        current = int(info.get("current") or 0)
        stage = str(info.get("stage") or state.lower())

    percent = int(round((current / total) * 100)) if total > 0 else (100 if state == "SUCCESS" else 0)
    error = ""
    if state == "FAILURE":
        error = repr(raw_info)[:500]

    return {
        "ok": state not in {"FAILURE", "REVOKED"},
        "task_id": task_id,
        "state": state,
        "done": state in {"SUCCESS", "FAILURE", "REVOKED"},
        "current": current,
        "total": total,
        "percent": max(0, min(percent, 100)),
        "stage": stage,
        "kp_id": info.get("kp_id"),
        "ok_count": int(info.get("ok_count") or 0),
        "fail_count": int(info.get("fail_count") or 0),
        "result": result,
        "error": error,
    }


@router.patch("/kp/{kp_id}/card")
async def patch_kp_card(
    kp_id: int, body: KpCardUpdateIn, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """Admin 编辑富字段。Upsert kp_card_content；不触动 enrich_status。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    card = (
        await session.execute(
            select(KpCardContent).where(KpCardContent.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    if card is None:
        card = KpCardContent(kp_id=kp_id)
        session.add(card)
        # flush 让默认值就位
        await session.flush()

    if body.tier is not None:
        card.tier = KpTier(body.tier)
    if body.spec is not None:
        card.spec = body.spec
    if body.customer_voice is not None:
        card.customer_voice = body.customer_voice
    if body.sources is not None:
        card.sources = [s.model_dump() for s in body.sources]
    if body.applies_to is not None:
        card.applies_to = list(body.applies_to)
    if body.not_applicable is not None:
        card.not_applicable = list(body.not_applicable)
    if body.rebuttals is not None:
        card.rebuttals = [r.model_dump() for r in body.rebuttals]
    if body.sales is not None:
        card.sales = body.sales
    if body.trigger_questions is not None:
        card.trigger_questions = [str(x).strip() for x in body.trigger_questions if str(x).strip()]
    if body.aliases is not None:
        card.aliases = [str(x).strip() for x in body.aliases if str(x).strip()]
    if body.scenario is not None:
        card.scenario = body.scenario.strip() or None

    await session.commit()
    await session.refresh(card)
    # 富字段变更后异步重建 KP Milvus 索引（任一字段都会影响索引文本）
    res = await _async_reindex_kp(kp_id)
    # 重新拉 card：reindex_kp_sync 内部已写状态字段；refresh 让 _card_to_out 看到最新
    await session.refresh(card)
    out = _card_to_out(card)
    warn = _reindex_warning(res)
    if warn:
        out["reindexWarning"] = warn
    return out


@router.delete("/kp/{kp_id}/products/{product_id}")
async def unbind_kp_product(
    kp_id: int, product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    await session.execute(
        KpProductLink.__table__.delete()
        .where(KpProductLink.kp_id == kp_id)
        .where(KpProductLink.product_id == product_id)
    )
    # ProductKp 软删除：保留学员历史进度可追溯，不直接 delete
    pk = (
        await session.execute(
            select(ProductKp)
            .where(ProductKp.kp_id == kp_id)
            .where(ProductKp.product_id == product_id)
        )
    ).scalar_one_or_none()
    if pk is not None and pk.removed_at is None:
        pk.removed_at = datetime.utcnow()
    await session.commit()
    return {"ok": True}


# ── 学习闭环：单 KP 考题 ──────────────────────────────
def _exam_payload(card: KpCardContent | None) -> dict[str, Any]:
    if card is None:
        return {
            "exam_question": "",
            "exam_rubric": [],
            "exam_ref_chunk_ids": [],
            "exam_ref_kp_ids": [],
            "exam_status": "pending",
            "exam_generated_at": None,
            "exam_error": "",
        }
    status = (
        card.exam_status.value
        if hasattr(card.exam_status, "value")
        else str(card.exam_status)
    )
    return {
        "exam_question": card.exam_question or "",
        "exam_rubric": list(card.exam_rubric or []),
        "exam_ref_chunk_ids": list(card.exam_ref_chunk_ids or []),
        "exam_ref_kp_ids": list(card.exam_ref_kp_ids or []),
        "exam_status": status,
        "exam_generated_at": card.exam_generated_at.isoformat() if card.exam_generated_at else None,
        "exam_error": card.exam_error or "",
    }


async def _ensure_card(session: AsyncSession, kp_id: int) -> KpCardContent:
    card = (
        await session.execute(
            select(KpCardContent).where(KpCardContent.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    if card is None:
        card = KpCardContent(kp_id=kp_id)
        session.add(card)
        await session.flush()
    return card


@router.get("/kp/{kp_id}/exam")
async def get_kp_exam(
    kp_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    card = (
        await session.execute(select(KpCardContent).where(KpCardContent.kp_id == kp_id))
    ).scalar_one_or_none()
    return _exam_payload(card)


@router.put("/kp/{kp_id}/exam")
async def put_kp_exam(
    kp_id: int,
    body: KpExamUpdateIn,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Admin 手动编辑考题。同时把 exam_status 直接置 ready（人工已审定）。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    card = await _ensure_card(session, kp_id)
    if body.exam_question is not None:
        card.exam_question = body.exam_question
    if body.exam_rubric is not None:
        card.exam_rubric = [str(x).strip() for x in body.exam_rubric if str(x).strip()]
    if (card.exam_question or "").strip():
        card.exam_status = ExamStatus.ready
        card.exam_error = ""
        card.exam_generated_at = datetime.utcnow()
    else:
        card.exam_status = ExamStatus.pending
    await session.commit()
    await session.refresh(card)
    return _exam_payload(card)


@router.post("/kp/{kp_id}/exam/generate")
async def generate_kp_exam(
    kp_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """触发 LLM 生成单 KP 考题，写入 kp_card_content.exam_*。同步执行，调用方等待结果。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")

    card = await _ensure_card(session, kp_id)
    card.exam_status = ExamStatus.generating
    card.exam_error = ""
    await session.commit()

    from ..graphs.assessment_graph import generate_single_question_for_kp

    try:
        result = await generate_single_question_for_kp(kp_id)
    except Exception as e:  # noqa: BLE001
        card.exam_status = ExamStatus.error
        card.exam_error = f"{type(e).__name__}: {e}"[:500]
        await session.commit()
        await session.refresh(card)
        return _exam_payload(card)

    if not result or not result.get("question"):
        card.exam_status = ExamStatus.error
        card.exam_error = "LLM 未能基于现有素材生成有效考题（chunks/definition 为空或返回不规整）"
        await session.commit()
        await session.refresh(card)
        return _exam_payload(card)

    card.exam_question = result["question"]
    card.exam_rubric = list(result.get("rubric") or [])
    card.exam_ref_chunk_ids = list(result.get("ref_chunk_ids") or [])
    card.exam_ref_kp_ids = list(result.get("ref_kp_ids") or [])
    card.exam_status = ExamStatus.ready
    card.exam_generated_at = datetime.utcnow()
    card.exam_error = ""
    await session.commit()
    await session.refresh(card)
    return _exam_payload(card)


@router.post("/kp/exam/generate-batch")
async def generate_kp_exam_batch(
    body: KpBulkIdsRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """批量生成考题。失败的 KP 会被标记 status=error 并记 error，但不影响其他 KP 继续。"""
    from ..graphs.assessment_graph import generate_single_question_for_kp

    requested = list(dict.fromkeys(body.kp_ids))
    if not requested:
        return {"ok": True, "triggered": 0, "succeeded": [], "failed": []}

    succeeded: list[int] = []
    failed: list[dict[str, Any]] = []

    for kp_id in requested:
        kp = await session.get(KpRegistry, kp_id)
        if not kp:
            failed.append({"kp_id": kp_id, "error": "kp not found"})
            continue
        card = await _ensure_card(session, kp_id)
        card.exam_status = ExamStatus.generating
        await session.commit()

        try:
            result = await generate_single_question_for_kp(kp_id)
        except Exception as e:  # noqa: BLE001
            card.exam_status = ExamStatus.error
            card.exam_error = f"{type(e).__name__}: {e}"[:500]
            await session.commit()
            failed.append({"kp_id": kp_id, "error": card.exam_error})
            continue

        if not result or not result.get("question"):
            card.exam_status = ExamStatus.error
            card.exam_error = "LLM 未能生成有效考题"
            await session.commit()
            failed.append({"kp_id": kp_id, "error": card.exam_error})
            continue

        card.exam_question = result["question"]
        card.exam_rubric = list(result.get("rubric") or [])
        card.exam_ref_chunk_ids = list(result.get("ref_chunk_ids") or [])
        card.exam_ref_kp_ids = list(result.get("ref_kp_ids") or [])
        card.exam_status = ExamStatus.ready
        card.exam_generated_at = datetime.utcnow()
        card.exam_error = ""
        await session.commit()
        succeeded.append(kp_id)

    return {
        "ok": not failed,
        "triggered": len(requested),
        "succeeded": succeeded,
        "failed": failed,
    }
