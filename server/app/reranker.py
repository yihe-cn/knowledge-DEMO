"""Rerank 抽象层。

走远端 cross-encoder 兼容接口（默认 SiliconFlow `/v1/rerank`，模型 BAAI/bge-reranker-v2-m3）。
对齐 OpenAI 兼容厂商常见 rerank 协议：POST {base}/rerank, body 含 model/query/documents/top_n。
"""
from __future__ import annotations

import httpx

from .config import settings


_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class RerankError(RuntimeError):
    pass


def _resolve_creds() -> tuple[str, str]:
    api_key = settings.reranker_api_key or settings.embedding_api_key
    base_url = settings.reranker_base_url or settings.embedding_base_url
    return api_key, base_url


async def rerank(query: str, documents: list[str], top_n: int) -> list[tuple[int, float]]:
    """对 documents 按与 query 的相关性打分并截 top_n，返回 [(原始 index, score), ...] 已降序。"""
    if not documents:
        return []
    api_key, base_url = _resolve_creds()
    if not api_key:
        raise RerankError("RERANKER_API_KEY / EMBEDDING_API_KEY 未配置")
    url = base_url.rstrip("/") + "/rerank"
    payload = {
        "model": settings.reranker_model,
        "query": query,
        "documents": documents,
        "top_n": top_n,
        "return_documents": False,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
    if resp.status_code >= 400:
        raise RerankError(f"rerank 调用失败 {resp.status_code}: {resp.text[:300]}")
    results = resp.json().get("results", [])
    out: list[tuple[int, float]] = []
    for item in results:
        try:
            idx = int(item["index"])
            score = float(item.get("relevance_score", 0.0))
        except (KeyError, TypeError, ValueError):
            continue
        out.append((idx, score))
    return out
