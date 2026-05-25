"""Milvus 集合封装。仅用于 `kb_chunks` 一个集合。

字段：
- chunk_id (INT64, primary)：与 MySQL kb_chunk.id 一一对应
- doc_id (INT64)
- kp_ids (ARRAY<INT64>)：先空，KP 抽取/审批后回写
- vector (FLOAT_VECTOR, dim=settings.milvus_dim)
"""
from __future__ import annotations

from functools import lru_cache
from typing import Iterable

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    connections,
    utility,
)

from .config import settings


_CONN_ALIAS = "default"


def _ensure_connection() -> None:
    if connections.has_connection(_CONN_ALIAS):
        return
    connections.connect(alias=_CONN_ALIAS, uri=settings.milvus_uri)


def _build_schema() -> CollectionSchema:
    return CollectionSchema(
        fields=[
            FieldSchema(name="chunk_id", dtype=DataType.INT64, is_primary=True, auto_id=False),
            FieldSchema(name="doc_id", dtype=DataType.INT64),
            FieldSchema(
                name="kp_ids",
                dtype=DataType.ARRAY,
                element_type=DataType.INT64,
                max_capacity=32,
            ),
            FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=settings.milvus_dim),
        ],
        description="SIMUGO KB chunk embeddings",
        enable_dynamic_field=False,
    )


@lru_cache(maxsize=1)
def get_collection() -> Collection:
    _ensure_connection()
    name = settings.milvus_collection
    if not utility.has_collection(name):
        coll = Collection(name=name, schema=_build_schema())
        coll.create_index(
            field_name="vector",
            index_params={
                "index_type": "HNSW",
                "metric_type": "COSINE",
                "params": {"M": 16, "efConstruction": 200},
            },
        )
    else:
        coll = Collection(name=name)
    coll.load()
    return coll


def upsert_chunks(rows: Iterable[dict]) -> None:
    """rows: [{chunk_id, doc_id, kp_ids, vector}]"""
    items = list(rows)
    if not items:
        return
    coll = get_collection()
    coll.upsert(
        [
            [r["chunk_id"] for r in items],
            [r["doc_id"] for r in items],
            [r.get("kp_ids") or [] for r in items],
            [r["vector"] for r in items],
        ]
    )
    coll.flush()


_DOC_IDS_BATCH = 200  # 单次 Milvus expr 里塞的 doc_id 上限；超过分批 search + score merge


def _search_one(
    coll, query_vector: list[float], top_k: int, expr: str | None
) -> list[dict]:
    res = coll.search(
        data=[query_vector],
        anns_field="vector",
        param={"metric_type": "COSINE", "params": {"ef": 64}},
        limit=top_k,
        expr=expr,
        output_fields=["doc_id", "kp_ids"],
    )
    out = []
    for hit in res[0]:
        out.append(
            {
                "chunk_id": int(hit.id),
                "score": float(hit.distance),
                "doc_id": int(hit.entity.get("doc_id")),
                "kp_ids": list(hit.entity.get("kp_ids") or []),
            }
        )
    return out


def search(
    query_vector: list[float],
    top_k: int = 12,
    kp_id: int | None = None,
    doc_ids: list[int] | None = None,
) -> list[dict]:
    coll = get_collection()
    kp_clause = f"array_contains(kp_ids, {int(kp_id)})" if kp_id is not None else None

    # 没有 doc_ids 过滤或 doc_ids 小，单次搞定
    if not doc_ids or len(doc_ids) <= _DOC_IDS_BATCH:
        parts = []
        if kp_clause:
            parts.append(kp_clause)
        if doc_ids:
            ids = ",".join(str(int(d)) for d in doc_ids)
            parts.append(f"doc_id in [{ids}]")
        return _search_one(coll, query_vector, top_k, " and ".join(parts) if parts else None)

    # doc_ids 过多：分批检索 + 按 score 合并 + 去重 + 截 top_k
    merged: dict[int, dict] = {}
    for i in range(0, len(doc_ids), _DOC_IDS_BATCH):
        batch = doc_ids[i : i + _DOC_IDS_BATCH]
        ids = ",".join(str(int(d)) for d in batch)
        parts = []
        if kp_clause:
            parts.append(kp_clause)
        parts.append(f"doc_id in [{ids}]")
        for h in _search_one(coll, query_vector, top_k, " and ".join(parts)):
            cid = h["chunk_id"]
            # 同一 chunk_id 多批不可能命中（doc_id 是分批互斥）；保险起见取较高 score
            if cid not in merged or merged[cid]["score"] < h["score"]:
                merged[cid] = h
    return sorted(merged.values(), key=lambda x: x["score"], reverse=True)[:top_k]


def delete_by_chunk_ids(chunk_ids: list[int]) -> None:
    if not chunk_ids:
        return
    coll = get_collection()
    ids_expr = ",".join(str(int(c)) for c in chunk_ids)
    coll.delete(expr=f"chunk_id in [{ids_expr}]")
    coll.flush()


def delete_by_doc(doc_id: int) -> None:
    coll = get_collection()
    coll.delete(expr=f"doc_id == {int(doc_id)}")
    coll.flush()


class MilvusChunkMissing(LookupError):
    """update_kp_ids 时 Milvus 查不到对应 chunk —— 不能静默成功，调用方必须当失败处理。"""


def update_kp_ids(chunk_id: int, kp_ids: list[int]) -> None:
    """KP 审批后回写。Milvus 不支持单字段 update，用 upsert 同 id 整行覆盖前需先读 vector。
    为简单起见这里走 query+upsert 模式（MVP 量级可接受）。

    若 Milvus 里没有该 chunk_id（MySQL 与向量库不同步、向量被人工删过、入库时漏写），
    抛 MilvusChunkMissing；调用方应把这条 chunk 计入失败列表并提示 reconcile。
    """
    coll = get_collection()
    rows = coll.query(
        expr=f"chunk_id == {int(chunk_id)}",
        output_fields=["chunk_id", "doc_id", "vector"],
        limit=1,
    )
    if not rows:
        raise MilvusChunkMissing(f"chunk_id={chunk_id} 在 Milvus 中不存在")
    r = rows[0]
    coll.upsert(
        [
            [int(r["chunk_id"])],
            [int(r["doc_id"])],
            [kp_ids],
            [r["vector"]],
        ]
    )
    coll.flush()
