"""最小 internal token 鉴权。

启用方式：在 `.env` 设置 `INTERNAL_TOKEN=xxx`；不设置时所有请求放行（开发模式）。
前端调用时通过 `X-Internal-Token` 请求头携带。
"""
from __future__ import annotations

from fastapi import Header, HTTPException

from .config import settings


async def require_internal_token(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    expected = settings.internal_token
    if not expected:
        # 未配置 token -> 视为开发模式，放行
        return
    if x_internal_token != expected:
        raise HTTPException(status_code=401, detail="invalid or missing X-Internal-Token")
