"""管理后台仪表盘只读接口。MVP 直接从原表实时聚合，量级小够用。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    DocStatus,
    KbChunk,
    KbDocument,
    KpChunkLink,
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    get_session,
)

router = APIRouter()


@router.get("/dashboard/overview")
async def overview(
    product_id: int | None = None, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    # KP 各状态计数
    kp_stmt = select(KpRegistry.status, func.count(KpRegistry.id)).group_by(KpRegistry.status)
    if product_id is not None:
        kp_stmt = kp_stmt.join(KpProductLink, KpProductLink.kp_id == KpRegistry.id).where(
            KpProductLink.product_id == product_id
        )
    kp_rows = (await session.execute(kp_stmt)).all()
    kp_counts = {
        (s.value if hasattr(s, "value") else str(s)): int(c) for s, c in kp_rows
    }
    kp_total = sum(kp_counts.values())
    kp_approved = kp_counts.get("approved", 0)
    kp_draft = kp_counts.get("draft", 0)
    kp_archived = kp_counts.get("archived", 0)

    # 文档计数
    doc_stmt = select(KbDocument.status, func.count(KbDocument.id)).group_by(KbDocument.status)
    if product_id is not None:
        doc_stmt = doc_stmt.where(KbDocument.product_id == product_id)
    doc_rows = (await session.execute(doc_stmt)).all()
    doc_counts = {
        (s.value if hasattr(s, "value") else str(s)): int(c) for s, c in doc_rows
    }
    doc_total = sum(doc_counts.values())

    return {
        "kp_total": kp_total,
        "kp_approved": kp_approved,
        "kp_draft": kp_draft,
        "kp_archived": kp_archived,
        "approved_ratio": (kp_approved / kp_total) if kp_total else 0.0,
        "doc_total": doc_total,
        "doc_ready": doc_counts.get("ready", 0),
        "doc_failed": doc_counts.get("failed", 0),
        "doc_pending": doc_counts.get("pending", 0) + doc_counts.get("processing", 0),
        "pending_review": kp_draft,
    }


@router.get("/dashboard/kp-map")
async def kp_map(
    product_id: int | None = None, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """未传 product_id：按产品分组；传了：按 category 分组（产品内钻取）。"""
    approved_case = func.sum(case((KpRegistry.status == KpStatus.approved, 1), else_=0))
    draft_case = func.sum(case((KpRegistry.status == KpStatus.draft, 1), else_=0))

    if product_id is None:
        rows = (
            await session.execute(
                select(
                    Product.id,
                    Product.code,
                    Product.name,
                    func.count(KpRegistry.id).label("total"),
                    approved_case.label("approved"),
                    draft_case.label("draft"),
                )
                .join(KpProductLink, KpProductLink.product_id == Product.id, isouter=True)
                .join(KpRegistry, KpRegistry.id == KpProductLink.kp_id, isouter=True)
                .group_by(Product.id, Product.code, Product.name)
                .order_by(Product.id)
            )
        ).all()
        return {
            "group_by": "product",
            "items": [
                {
                    "product_id": int(pid),
                    "product_code": code,
                    "product_name": name,
                    "total": int(total or 0),
                    "approved": int(approved or 0),
                    "draft": int(draft or 0),
                }
                for pid, code, name, total, approved, draft in rows
            ],
        }

    rows = (
        await session.execute(
            select(
                KpRegistry.category,
                func.count(KpRegistry.id).label("total"),
                approved_case.label("approved"),
                draft_case.label("draft"),
            )
            .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
            .where(KpProductLink.product_id == product_id)
            .group_by(KpRegistry.category)
            .order_by(desc(func.count(KpRegistry.id)))
        )
    ).all()
    return {
        "group_by": "category",
        "items": [
            {
                "category": cat or "未分类",
                "total": int(total or 0),
                "approved": int(approved or 0),
                "draft": int(draft or 0),
            }
            for cat, total, approved, draft in rows
        ],
    }


@router.get("/dashboard/attention")
async def attention(
    product_id: int | None = None, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []

    # 1) 待审核 KP（draft）—— 最近 20 个
    draft_stmt = (
        select(KpRegistry)
        .where(KpRegistry.status == KpStatus.draft)
        .order_by(desc(KpRegistry.id))
        .limit(20)
    )
    if product_id is not None:
        draft_stmt = draft_stmt.join(KpProductLink, KpProductLink.kp_id == KpRegistry.id).where(
            KpProductLink.product_id == product_id
        )
    draft_kps = (await session.execute(draft_stmt)).scalars().all()
    for kp in draft_kps:
        items.append(
            {
                "type": "pending_kp",
                "target_id": kp.id,
                "title": f"待审核 KP：{kp.name}",
                "detail": (kp.definition or "")[:120],
            }
        )

    # 2) 抽取失败 / 文档失败
    failed_stmt = (
        select(KbDocument)
        .where(KbDocument.status == DocStatus.failed)
        .order_by(desc(KbDocument.id))
        .limit(10)
    )
    if product_id is not None:
        failed_stmt = failed_stmt.where(KbDocument.product_id == product_id)
    failed_docs = (await session.execute(failed_stmt)).scalars().all()
    for d in failed_docs:
        items.append(
            {
                "type": "failed_doc",
                "target_id": d.id,
                "title": f"文档解析失败：{d.file_name}",
                "detail": (d.error or "")[:200],
            }
        )

    # 3) approved 但没有任何 chunk 绑定的 KP（薄弱信号代理）
    no_chunk_stmt = (
        select(KpRegistry)
        .outerjoin(KpChunkLink, KpChunkLink.kp_id == KpRegistry.id)
        .where(KpRegistry.status == KpStatus.approved)
        .group_by(KpRegistry.id)
        .having(func.count(KpChunkLink.id) == 0)
        .limit(20)
    )
    if product_id is not None:
        no_chunk_stmt = no_chunk_stmt.join(
            KpProductLink, KpProductLink.kp_id == KpRegistry.id
        ).where(KpProductLink.product_id == product_id)
    no_chunk_rows = (await session.execute(no_chunk_stmt)).scalars().all()
    for kp in no_chunk_rows:
        items.append(
            {
                "type": "kp_no_chunk",
                "target_id": kp.id,
                "title": f"KP 无关联素材：{kp.name}",
                "detail": "approved 但未绑定任何 chunk，建议手工补充或归档",
            }
        )

    return {"items": items, "total": len(items)}


@router.get("/dashboard/kp/{kp_id}/detail")
async def kp_detail(kp_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    chunk_count = (
        await session.execute(
            select(func.count(KpChunkLink.id)).where(KpChunkLink.kp_id == kp_id)
        )
    ).scalar_one()

    doc_rows = (
        await session.execute(
            select(KbDocument.id, KbDocument.file_name, func.count(KbChunk.id))
            .join(KbChunk, KbChunk.doc_id == KbDocument.id)
            .join(KpChunkLink, KpChunkLink.chunk_id == KbChunk.id)
            .where(KpChunkLink.kp_id == kp_id)
            .group_by(KbDocument.id, KbDocument.file_name)
            .order_by(desc(func.count(KbChunk.id)))
        )
    ).all()

    return {
        "id": kp.id,
        "name": kp.name,
        "definition": kp.definition,
        "category": kp.category,
        "status": kp.status.value if hasattr(kp.status, "value") else str(kp.status),
        "version": kp.version,
        "chunk_count": int(chunk_count),
        "documents": [
            {"doc_id": int(did), "doc_name": dn, "chunk_count": int(cc)}
            for did, dn, cc in doc_rows
        ],
    }
