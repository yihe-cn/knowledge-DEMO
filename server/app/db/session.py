from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from ..config import settings


engine = create_async_engine(settings.mysql_dsn, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# 同步引擎给 Celery worker 使用
sync_engine = create_engine(settings.mysql_dsn_sync, pool_pre_ping=True, pool_recycle=3600)
SyncSessionLocal = sessionmaker(sync_engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
