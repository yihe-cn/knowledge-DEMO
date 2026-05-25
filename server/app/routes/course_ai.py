"""课程 AI 接口：

- POST /products/{id}/kps/bootstrap：基于产品元数据冷启动一批 approved KP
- POST /products/{id}/kps/reorganize：基于已有 approved KP，LLM 重排 category

设计要点：
- LLM 调用前先释放读事务，避免在慢调用期间占着 DB 连接。
- bootstrap 写入时按行 savepoint 包裹，IntegrityError 时 rollback savepoint
  并回查已存在的 KP；同名 KP 必须 status=approved 才允许复用，否则归入
  conflicts 返回给前端，不静默吞掉。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    ProductLinkSource,
    get_session,
)
from ..practice_role import generate_kp_bootstrap, reorganize_kp_categories

router = APIRouter()


def _kp_status_value(s: Any) -> str:
    return s.value if hasattr(s, "value") else str(s)


@router.post("/products/{product_id}/kps/bootstrap")
async def bootstrap_kps(
    product_id: int,
    module_count: int = Query(4, ge=2, le=8),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    # 阶段 1：读 product 快照
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    snapshot = {
        "name": p.name,
        "industry": p.industry or "",
        "student_role": p.student_role or "",
        "customer_label": p.customer_label or "客户",
        "description": p.description or "",
    }
    await session.rollback()  # 释放读事务

    # 阶段 2：LLM 调用
    candidates = await generate_kp_bootstrap(
        product_name=snapshot["name"],
        industry=snapshot["industry"],
        student_role=snapshot["student_role"],
        customer_label=snapshot["customer_label"],
        description=snapshot["description"],
        module_count=module_count,
    )
    if not candidates:
        raise HTTPException(503, "LLM 未返回有效知识点")

    # 阶段 3：逐条入库；每条用 savepoint 隔离 IntegrityError
    new_kps = 0
    new_links = 0
    reused = 0
    conflicts: list[dict[str, str]] = []

    try:
        existing_links = set(
            (
                await session.execute(
                    select(KpProductLink.kp_id).where(KpProductLink.product_id == product_id)
                )
            ).scalars().all()
        )

        for cand in candidates:
            name = cand["name"]
            # 优先查现有同名 KP
            existing_kp = (
                await session.execute(select(KpRegistry).where(KpRegistry.name == name))
            ).scalar_one_or_none()

            if existing_kp is None:
                # 尝试插入；并发可能抢先 → IntegrityError 回查
                async with session.begin_nested() as sp:
                    try:
                        kp = KpRegistry(
                            name=name,
                            definition=cand["definition"],
                            category=cand["category"],
                            status=KpStatus.approved,
                            created_by="llm-bootstrap",
                        )
                        session.add(kp)
                        await session.flush()
                    except IntegrityError:
                        await sp.rollback()
                        kp = None  # 标记需要回查
                if kp is None:
                    existing_kp = (
                        await session.execute(select(KpRegistry).where(KpRegistry.name == name))
                    ).scalar_one_or_none()
                else:
                    new_kps += 1

            if existing_kp is not None:
                # 复用前校验：必须 approved，否则不静默挂上去
                if existing_kp.status != KpStatus.approved:
                    conflicts.append({
                        "name": name,
                        "reason": f"existing_status={_kp_status_value(existing_kp.status)}",
                    })
                    continue
                kp = existing_kp
                reused += 1

            # kp 此时一定指向一个 approved KP
            if kp.id in existing_links:
                continue
            async with session.begin_nested() as sp:
                try:
                    session.add(
                        KpProductLink(
                            kp_id=kp.id,
                            product_id=product_id,
                            source=ProductLinkSource.auto,
                        )
                    )
                    await session.flush()
                    existing_links.add(kp.id)
                    new_links += 1
                except IntegrityError:
                    # 并发插入了同一对 (kp_id, product_id)；忽略
                    await sp.rollback()
                    existing_links.add(kp.id)

        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(409, f"KP 写入冲突：{e.orig}") from e

    return {
        "ok": True,
        "new_kps": new_kps,
        "reused": reused,
        "new_links": new_links,
        "total": len(candidates),
        "conflicts": conflicts,
    }


@router.post("/products/{product_id}/kps/reorganize")
async def reorganize_kps(
    product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    # 阶段 1：读快照
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")

    rows = (
        await session.execute(
            select(KpRegistry)
            .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
            .where(KpProductLink.product_id == product_id)
            .where(KpRegistry.status == KpStatus.approved)
            .order_by(KpRegistry.id)
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(400, "该产品没有已审定 KP，无法重组")

    payload = [
        {
            "id": k.id,
            "name": k.name,
            "definition": k.definition or "",
            "category": k.category or "",
        }
        for k in rows
    ]
    # 释放读事务再调 LLM
    await session.rollback()

    # 阶段 2：LLM
    mapping = await reorganize_kp_categories(payload)
    if not mapping:
        raise HTTPException(503, "LLM 未返回有效分类映射")

    # 阶段 3：用最新数据写入（重读避免读快照陈旧）
    try:
        rows = (
            await session.execute(
                select(KpRegistry)
                .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
                .where(KpProductLink.product_id == product_id)
                .where(KpRegistry.status == KpStatus.approved)
                .order_by(KpRegistry.id)
            )
        ).scalars().all()
        changed: list[dict[str, Any]] = []
        for kp in rows:
            new_cat = mapping.get(kp.id)
            if not new_cat:
                continue
            old = kp.category or ""
            if new_cat != old:
                changed.append({"id": kp.id, "name": kp.name, "old": old, "new": new_cat})
                kp.category = new_cat
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(409, f"KP 重组写入冲突：{e.orig}") from e

    return {"ok": True, "changed": changed, "total": len(rows)}
