"""演练角色（PracticeRole）管理接口。

关键不变量：
- 每个 product 至多一个 is_default=true（DB 用生成列 + 唯一索引强制）。
- AI 产物 source=ai；管理员编辑过的行升级为 source=manual，不会被「重生成」清掉。
- LLM 调用前先释放读事务（rollback），返回后再开短事务写入；
  写入冲突（IntegrityError）转 409，不让单次失败留下脏 session。
- 删除 default 行时同事务自动把同 product 的下一条提升为 default。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    KpProductLink,
    KpRegistry,
    KpStatus,
    PracticeRole,
    PracticeRoleSource,
    Product,
    get_session,
)
from ..practice_role import generate_roles

router = APIRouter()


def role_to_dict(r: PracticeRole) -> dict[str, Any]:
    return {
        "id": r.id,
        "product_id": r.product_id,
        "is_default": bool(r.is_default),
        "name": r.name,
        "age": r.age,
        "job": r.job,
        "city": r.city,
        "family": r.family,
        "budget": r.budget,
        "tagline": r.tagline,
        "vibe": r.vibe,
        "emoji": r.emoji,
        "avatar": r.avatar,
        "avatarColor": r.avatar_color,
        "motivation": r.motivation,
        "opener": r.opener,
        "context": r.context,
        "promptSeed": r.prompt_seed,
        "personality": r.personality or [],
        "concerns": r.concerns or [],
        "mood": r.mood or {"interest": 50, "trust": 40},
        "source": r.source.value if hasattr(r.source, "value") else str(r.source),
    }


@router.get("/products/{product_id}/roles")
async def list_roles(
    product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    rows = (
        await session.execute(
            select(PracticeRole)
            .where(PracticeRole.product_id == product_id)
            .order_by(PracticeRole.is_default.desc(), PracticeRole.id)
        )
    ).scalars().all()
    return {"items": [role_to_dict(r) for r in rows]}


def _build_role_row(product_id: int, item: dict, *, is_default: bool) -> PracticeRole:
    """item 已经过 generator 端 Pydantic + clip 处理，这里只补 DB 字段。"""
    return PracticeRole(
        product_id=product_id,
        is_default=is_default,
        name=item["name"],
        age=item["age"],
        job=item["job"],
        city=item["city"],
        family=item["family"],
        budget=item["budget"],
        tagline=item["tagline"],
        vibe=item["vibe"],
        emoji=item["emoji"],
        avatar=item["avatar"],
        avatar_color=item["avatarColor"],
        motivation=item["motivation"],
        opener=item["opener"],
        context=item["context"],
        prompt_seed=item["promptSeed"],
        personality=item["personality"],
        concerns=item["concerns"],
        mood=item["mood"],
        source=PracticeRoleSource.ai,
    )


@router.post("/products/{product_id}/roles/generate")
async def generate_product_roles(
    product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    # === 阶段 1：读取产品 + KP 名（短事务）===
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    prod_snapshot = {
        "name": p.name,
        "industry": p.industry or "",
        "student_role": p.student_role or "",
        "customer_label": p.customer_label or "客户",
        "description": p.description or "",
    }
    kp_names: list[str] = list(
        (
            await session.execute(
                select(KpRegistry.name)
                .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
                .where(KpProductLink.product_id == product_id)
                .where(KpRegistry.status == KpStatus.approved)
                .order_by(KpRegistry.id)
                .limit(30)
            )
        ).scalars()
    )
    # 释放读事务，避免在 LLM 慢调用期间占着连接
    await session.rollback()

    # === 阶段 2：LLM 调用（无事务）===
    raw_roles = await generate_roles(
        product_name=prod_snapshot["name"],
        industry=prod_snapshot["industry"],
        student_role=prod_snapshot["student_role"],
        customer_label=prod_snapshot["customer_label"],
        description=prod_snapshot["description"],
        kp_names=kp_names,
    )
    if not raw_roles:
        raise HTTPException(503, "LLM 未返回有效角色，请稍后重试")

    # === 阶段 3：写库（短事务 + FOR UPDATE 锁）===
    try:
        # 锁定该 product 的所有现存 role，避免与并发 set-default / 另一次 generate 抢
        await session.execute(
            select(PracticeRole.id)
            .where(PracticeRole.product_id == product_id)
            .with_for_update()
        )

        await session.execute(
            delete(PracticeRole)
            .where(PracticeRole.product_id == product_id)
            .where(PracticeRole.source == PracticeRoleSource.ai)
        )

        has_manual_default = (
            await session.execute(
                select(PracticeRole.id)
                .where(PracticeRole.product_id == product_id)
                .where(PracticeRole.is_default.is_(True))
                .limit(1)
            )
        ).scalar_one_or_none() is not None

        created: list[PracticeRole] = []
        for idx, item in enumerate(raw_roles):
            is_default = (not has_manual_default) and (idx == 0)
            row = _build_role_row(product_id, item, is_default=is_default)
            session.add(row)
            created.append(row)

        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(409, f"角色写入冲突：{e.orig}") from e

    for r in created:
        await session.refresh(r)
    return {"items": [role_to_dict(r) for r in created]}


class RolePatch(BaseModel):
    name: str | None = None
    age: int | None = None
    job: str | None = None
    city: str | None = None
    family: str | None = None
    budget: str | None = None
    tagline: str | None = None
    vibe: str | None = None
    emoji: str | None = None
    avatar: str | None = None
    avatarColor: str | None = None
    motivation: str | None = None
    opener: str | None = None
    context: str | None = None
    promptSeed: str | None = None
    personality: list[str] | None = None
    concerns: list[str] | None = None
    mood: dict | None = None


@router.patch("/practice-roles/{role_id}")
async def patch_role(
    role_id: int, body: RolePatch, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    r = await session.get(PracticeRole, role_id)
    if not r:
        raise HTTPException(404, "role not found")
    data = body.model_dump(exclude_unset=True)
    field_map = {
        "name": "name",
        "age": "age",
        "job": "job",
        "city": "city",
        "family": "family",
        "budget": "budget",
        "tagline": "tagline",
        "vibe": "vibe",
        "emoji": "emoji",
        "avatar": "avatar",
        "avatarColor": "avatar_color",
        "motivation": "motivation",
        "opener": "opener",
        "context": "context",
        "promptSeed": "prompt_seed",
        "personality": "personality",
        "concerns": "concerns",
        "mood": "mood",
    }
    for k, attr in field_map.items():
        if k in data and data[k] is not None:
            setattr(r, attr, data[k])
    # 管理员编辑过 → 升级为 manual，下次 AI 重生成不会清掉
    r.source = PracticeRoleSource.manual
    await session.commit()
    await session.refresh(r)
    return role_to_dict(r)


@router.delete("/practice-roles/{role_id}")
async def delete_role(
    role_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    r = await session.get(PracticeRole, role_id)
    if not r:
        raise HTTPException(404, "role not found")
    was_default = bool(r.is_default)
    product_id = r.product_id

    try:
        if was_default:
            # 锁住同 product 全部行，避免与并发 generate / set-default 撞唯一索引
            await session.execute(
                select(PracticeRole.id)
                .where(PracticeRole.product_id == product_id)
                .with_for_update()
            )
        await session.delete(r)
        await session.flush()

        # 若删的是 default，提升下一条（按 id 升序）为新 default
        if was_default:
            next_row = (
                await session.execute(
                    select(PracticeRole)
                    .where(PracticeRole.product_id == product_id)
                    .order_by(PracticeRole.id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if next_row is not None:
                next_row.is_default = True

        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(409, f"删除时默认角色约束冲突：{e.orig}") from e

    return {"ok": True}


@router.post("/practice-roles/{role_id}/set-default")
async def set_default_role(
    role_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    r = await session.get(PracticeRole, role_id)
    if not r:
        raise HTTPException(404, "role not found")
    product_id = r.product_id

    try:
        # 1) 锁住同 product 的全部行
        await session.execute(
            select(PracticeRole.id)
            .where(PracticeRole.product_id == product_id)
            .with_for_update()
        )
        # 2) 先把同 product 所有行置 false（必须先于设置目标为 true，否则唯一索引冲突）
        await session.execute(
            update(PracticeRole)
            .where(PracticeRole.product_id == product_id)
            .values(is_default=False)
        )
        # 3) flush 让 DB 看到 false，再把目标行置 true
        await session.flush()
        r.is_default = True
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(409, f"默认角色切换冲突：{e.orig}") from e

    await session.refresh(r)
    return role_to_dict(r)
