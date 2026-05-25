"""KP Registry admin 接口。仅 internal 使用，不做鉴权（MVP）。"""
from __future__ import annotations

from typing import Any

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    KbChunk,
    KbDocument,
    KpChunkLink,
    KpExtractionJob,
    KpProductLink,
    KpRegistry,
    KpStatus,
    LinkSource,
    Product,
    ProductLinkSource,
    get_session,
)
from ..schemas import (
    KpBulkApproveRequest,
    KpLinkRequest,
    KpMergeRequest,
    KpProductBindRequest,
)
from ..vector_store import update_kp_ids


router = APIRouter()


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
        stmt = stmt.join(KpProductLink, KpProductLink.kp_id == KpRegistry.id).where(
            KpProductLink.product_id == product_id
        )
    rows = (await session.execute(stmt)).scalars().all()
    return {"items": [KpOut.from_orm_kp(r).model_dump() for r in rows]}


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

    return KpOut.from_orm_kp(kp).model_dump()


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
    return {"ok": True, "rewritten_chunks": rewritten}


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
    body: KpBulkApproveRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    if not body.kp_ids:
        return {"ok": True, "approved": 0, "rewritten_chunks": 0}
    await session.execute(
        update(KpRegistry).where(KpRegistry.id.in_(body.kp_ids)).values(status=KpStatus.approved)
    )
    await session.commit()

    chunk_ids = (
        await session.execute(
            select(KpChunkLink.chunk_id).where(KpChunkLink.kp_id.in_(body.kp_ids)).distinct()
        )
    ).scalars().all()
    rewritten = await _rewrite_chunks_in_milvus(session, [int(c) for c in chunk_ids])
    return {"ok": True, "approved": len(body.kp_ids), "rewritten_chunks": rewritten}


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


@router.post("/kp/{kp_id}/products")
async def bind_kp_products(
    kp_id: int, body: KpProductBindRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """全量替换 KP 的产品绑定。manual 来源。"""
    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    # 清掉旧的，全部以新的为准
    await session.execute(
        KpProductLink.__table__.delete().where(KpProductLink.kp_id == kp_id)
    )
    for pid in set(body.product_ids):
        session.add(
            KpProductLink(kp_id=kp_id, product_id=pid, source=ProductLinkSource.manual)
        )
    await session.commit()
    return {"ok": True, "product_ids": list(set(body.product_ids))}


@router.delete("/kp/{kp_id}/products/{product_id}")
async def unbind_kp_product(
    kp_id: int, product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    await session.execute(
        KpProductLink.__table__.delete()
        .where(KpProductLink.kp_id == kp_id)
        .where(KpProductLink.product_id == product_id)
    )
    await session.commit()
    return {"ok": True}
