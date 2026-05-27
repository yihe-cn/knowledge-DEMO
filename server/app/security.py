"""最小 internal token 鉴权。

启用方式：在 `.env` 设置 `INTERNAL_TOKEN=xxx`；不设置时所有请求放行（开发模式）。
前端调用时通过 `X-Internal-Token` 请求头携带。
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db.models import AssessmentAssignment
from .db.session import get_session


async def require_internal_token(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    expected = settings.internal_token
    if not expected:
        # 未配置 token -> 视为开发模式，放行
        return
    if x_internal_token != expected:
        raise HTTPException(status_code=401, detail="invalid or missing X-Internal-Token")


async def resolve_assignment_token(
    token: str | None = Query(default=None),
    x_token: str | None = Header(default=None, alias="X-Assessment-Token"),
    session: AsyncSession = Depends(get_session),
) -> AssessmentAssignment:
    """学员端考核入口的轻量鉴权：URL ?token=... 或 X-Assessment-Token 头任一。

    无 JWT、无过期。命中即返回 ORM 对象；不存在 → 404。
    """
    raw = token or x_token
    if not raw:
        raise HTTPException(status_code=401, detail="missing assessment token")
    res = await session.execute(
        select(AssessmentAssignment).where(AssessmentAssignment.token == raw)
    )
    assignment = res.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="assessment token not found")
    return assignment
