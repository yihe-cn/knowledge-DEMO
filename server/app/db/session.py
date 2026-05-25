from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from ..config import settings


_is_sqlite = settings.mysql_dsn.startswith("sqlite")

_async_kwargs: dict = {"pool_pre_ping": True}
_sync_kwargs: dict = {"pool_pre_ping": True}
if not _is_sqlite:
    _async_kwargs["pool_recycle"] = 3600
    _sync_kwargs["pool_recycle"] = 3600

engine = create_async_engine(settings.mysql_dsn, **_async_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# 同步引擎给 Celery worker / 启动期 schema 初始化使用
sync_engine = create_engine(settings.mysql_dsn_sync, **_sync_kwargs)
SyncSessionLocal = sessionmaker(sync_engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
