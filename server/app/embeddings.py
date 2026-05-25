"""Embedding 抽象层。

MVP 阶段走远端 BGE-M3 兼容接口（默认硅基流动），保持签名稳定，未来切自托管不动调用方。
所有 provider 都对齐 OpenAI 风格 `/v1/embeddings`，差别只在 base_url / model / key。
"""
from __future__ import annotations

import asyncio
from typing import Iterable

import httpx

from .config import settings


_BATCH = 16
_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class EmbeddingError(RuntimeError):
    pass


async def _embed_batch(client: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
    if not settings.embedding_api_key:
        raise EmbeddingError("EMBEDDING_API_KEY 未配置")
    url = settings.embedding_base_url.rstrip("/") + "/embeddings"
    resp = await client.post(
        url,
        headers={"Authorization": f"Bearer {settings.embedding_api_key}"},
        json={"model": settings.embedding_model, "input": texts, "encoding_format": "float"},
    )
    if resp.status_code >= 400:
        raise EmbeddingError(f"embedding 调用失败 {resp.status_code}: {resp.text[:300]}")
    data = resp.json().get("data", [])
    return [item["embedding"] for item in data]


async def embed(texts: Iterable[str]) -> list[list[float]]:
    """对一批文本计算 embedding，输出顺序与输入一致。"""
    items = [t if t else " " for t in texts]
    if not items:
        return []
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for i in range(0, len(items), _BATCH):
            chunk = items[i : i + _BATCH]
            out.extend(await _embed_batch(client, chunk))
    return out


def embed_sync(texts: Iterable[str]) -> list[list[float]]:
    """同步入口，给 Celery worker 使用。"""
    return asyncio.run(embed(texts))
