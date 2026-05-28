"""Milvus Lite 集合封装。包含两个并列 collection：

`kb_chunks` — 文档切片向量
- chunk_id (INT64, primary)：与 SQL kb_chunk.id 一一对应
- doc_id (INT64)
- kp_ids (ARRAY<INT64>)：先空，KP 抽取/审批后回写
- vector (FLOAT_VECTOR, dim=settings.milvus_dim)

`kp_embeddings` — KP 自身向量（提升 query → KP 的语义召回）
- kp_id (INT64, primary)：与 SQL kp_registry.id 一一对应
- status (INT8)：1=approved, 0=draft/archived；过滤用
- vector (FLOAT_VECTOR, dim=settings.milvus_dim)

注意（Demo 用 Milvus Lite）：
- 索引类型只用 FLAT（Lite 不支持 HNSW）。几万条规模 FLAT 暴搜性能/召回都够。
- 通过 `MilvusClient(uri=settings.milvus_db_path)` 直接打开本地 .db 文件，
  不需要 etcd / MinIO / 独立 Milvus 服务。
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterable

from pymilvus import DataType, MilvusClient

from .config import settings


@contextmanager
def _client():
    # Milvus Lite locks the local .db file per process. Keep the Python client
    # scoped to one operation; vector writes still need to stay in the same
    # process as the API in Lite mode because the embedded server can retain
    # the file lock for the process lifetime.
    client = MilvusClient(uri=settings.milvus_db_path)
    try:
        yield client
    finally:
        client.close()


def _ensure_collection(client: MilvusClient) -> None:
    name = settings.milvus_collection
    if not client.has_collection(name):
        schema = client.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field("chunk_id", DataType.INT64, is_primary=True)
        schema.add_field("doc_id", DataType.INT64)
        schema.add_field(
            "kp_ids", DataType.ARRAY, element_type=DataType.INT64, max_capacity=32
        )
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=settings.milvus_dim)

        index_params = client.prepare_index_params()
        index_params.add_index(
            field_name="vector", index_type="FLAT", metric_type="COSINE"
        )

        client.create_collection(
            collection_name=name, schema=schema, index_params=index_params
        )

    # Milvus Lite 从 seed 文件加载进来时集合默认 "released"，必须 load 才能 search/query。
    # load_collection 是幂等的，重复调用是 no-op。
    client.load_collection(name)


def _ensure_kp_collection(client: MilvusClient) -> None:
    name = settings.milvus_kp_collection
    if not client.has_collection(name):
        schema = client.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field("kp_id", DataType.INT64, is_primary=True)
        schema.add_field("status", DataType.INT8)
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=settings.milvus_dim)

        index_params = client.prepare_index_params()
        index_params.add_index(
            field_name="vector", index_type="FLAT", metric_type="COSINE"
        )

        client.create_collection(
            collection_name=name, schema=schema, index_params=index_params
        )

    client.load_collection(name)


def _reload_collection() -> None:
    """search/query 报 'released' 时强制重新 load 一次。"""
    with _client() as client:
        _ensure_collection(client)


def _reload_kp_collection() -> None:
    with _client() as client:
        _ensure_kp_collection(client)


def get_collection_name() -> str:
    with _client() as client:
        _ensure_collection(client)
    return settings.milvus_collection


def num_entities() -> int:
    """供 /healthz 用，不存在则当 0。"""
    with _client() as client:
        if not client.has_collection(settings.milvus_collection):
            return 0
        stats = client.get_collection_stats(settings.milvus_collection)
        return int(stats.get("row_count", 0))


def upsert_chunks(rows: Iterable[dict]) -> None:
    """rows: [{chunk_id, doc_id, kp_ids, vector}]"""
    items = [
        {
            "chunk_id": int(r["chunk_id"]),
            "doc_id": int(r["doc_id"]),
            "kp_ids": list(r.get("kp_ids") or []),
            "vector": r["vector"],
        }
        for r in rows
    ]
    if not items:
        return
    with _client() as client:
        _ensure_collection(client)
        client.upsert(collection_name=settings.milvus_collection, data=items)


_DOC_IDS_BATCH = 200  # 单次 expr 里塞的 doc_id 上限；超过分批 search + score merge


def _search_one(
    client: MilvusClient, query_vector: list[float], top_k: int, expr: str | None
) -> list[dict]:
    def _do():
        return client.search(
            collection_name=settings.milvus_collection,
            data=[query_vector],
            anns_field="vector",
            search_params={"metric_type": "COSINE", "params": {}},
            limit=top_k,
            filter=expr or "",
            # pymilvus 3.x: 主键字段需显式 output_fields 才能在 hit 里读到
            output_fields=["chunk_id", "doc_id", "kp_ids"],
        )

    try:
        res = _do()
    except Exception as e:
        # collection released → 自愈：重新 load 一次再试
        if "released" in str(e).lower():
            client.load_collection(settings.milvus_collection)
            res = _do()
        else:
            raise

    out = []
    for hit in res[0]:
        # pymilvus 3.x + Milvus Lite：COSINE metric 下 hit.distance = cosine 距离
        # （0=最相似），而下游代码假设 score 越大越相关，所以这里翻成相似度。
        # 注意：这与早期 Milvus standalone（distance 直接是相似度）不同。
        dist = float(hit.distance)
        out.append(
            {
                "chunk_id": int(hit["chunk_id"]),
                "score": 1.0 - dist,
                "doc_id": int(hit["doc_id"]) if hit.get("doc_id") is not None else 0,
                "kp_ids": list(hit.get("kp_ids") or []),
            }
        )
    return out


def search(
    query_vector: list[float],
    top_k: int = 12,
    kp_id: int | None = None,
    doc_ids: list[int] | None = None,
) -> list[dict]:
    with _client() as client:
        _ensure_collection(client)
        kp_clause = f"array_contains(kp_ids, {int(kp_id)})" if kp_id is not None else None

        if not doc_ids or len(doc_ids) <= _DOC_IDS_BATCH:
            parts = []
            if kp_clause:
                parts.append(kp_clause)
            if doc_ids:
                ids = ",".join(str(int(d)) for d in doc_ids)
                parts.append(f"doc_id in [{ids}]")
            return _search_one(client, query_vector, top_k, " and ".join(parts) if parts else None)

        merged: dict[int, dict] = {}
        for i in range(0, len(doc_ids), _DOC_IDS_BATCH):
            batch = doc_ids[i : i + _DOC_IDS_BATCH]
            ids = ",".join(str(int(d)) for d in batch)
            parts = []
            if kp_clause:
                parts.append(kp_clause)
            parts.append(f"doc_id in [{ids}]")
            for h in _search_one(client, query_vector, top_k, " and ".join(parts)):
                cid = h["chunk_id"]
                if cid not in merged or merged[cid]["score"] < h["score"]:
                    merged[cid] = h
        return sorted(merged.values(), key=lambda x: x["score"], reverse=True)[:top_k]


def delete_by_chunk_ids(chunk_ids: list[int]) -> None:
    if not chunk_ids:
        return
    with _client() as client:
        _ensure_collection(client)
        client.delete(
            collection_name=settings.milvus_collection,
            filter=f"chunk_id in [{','.join(str(int(c)) for c in chunk_ids)}]",
        )


def delete_by_doc(doc_id: int) -> None:
    with _client() as client:
        _ensure_collection(client)
        client.delete(
            collection_name=settings.milvus_collection,
            filter=f"doc_id == {int(doc_id)}",
        )


class MilvusChunkMissing(LookupError):
    """update_kp_ids 时查不到对应 chunk —— 不能静默成功，调用方必须当失败处理。"""


def update_kp_ids(chunk_id: int, kp_ids: list[int]) -> None:
    """KP 审批后回写。Milvus 不支持单字段 update，用 upsert 同 id 整行覆盖前需先读 vector。"""
    with _client() as client:
        _ensure_collection(client)
        rows = client.query(
            collection_name=settings.milvus_collection,
            filter=f"chunk_id == {int(chunk_id)}",
            output_fields=["chunk_id", "doc_id", "vector"],
            limit=1,
        )
        if not rows:
            raise MilvusChunkMissing(f"chunk_id={chunk_id} 在 Milvus 中不存在")
        r = rows[0]
        client.upsert(
            collection_name=settings.milvus_collection,
            data=[
                {
                    "chunk_id": int(r["chunk_id"]),
                    "doc_id": int(r["doc_id"]),
                    "kp_ids": list(kp_ids),
                    "vector": r["vector"],
                }
            ],
        )


# ── KP 向量集合（与 kb_chunks 并列）────────────────────────────────────
def upsert_kp_embedding(kp_id: int, status: int, vector: list[float]) -> None:
    """单个 KP 行 upsert。status: 1=approved, 0=其他。"""
    with _client() as client:
        _ensure_kp_collection(client)
        client.upsert(
            collection_name=settings.milvus_kp_collection,
            data=[{"kp_id": int(kp_id), "status": int(status), "vector": vector}],
        )


def delete_kp_embedding(kp_id: int) -> None:
    with _client() as client:
        _ensure_kp_collection(client)
        client.delete(
            collection_name=settings.milvus_kp_collection,
            filter=f"kp_id == {int(kp_id)}",
        )


def search_kps(
    query_vector: list[float],
    top_k: int = 10,
    approved_only: bool = True,
) -> list[dict]:
    """根据 query 检索 KP 自身。返回 [{kp_id, score}]，score 是相似度（越大越相关）。"""
    with _client() as client:
        _ensure_kp_collection(client)

        def _do():
            return client.search(
                collection_name=settings.milvus_kp_collection,
                data=[query_vector],
                anns_field="vector",
                search_params={"metric_type": "COSINE", "params": {}},
                limit=top_k,
                filter="status == 1" if approved_only else "",
                output_fields=["kp_id", "status"],
            )

        try:
            res = _do()
        except Exception as e:
            if "released" in str(e).lower():
                client.load_collection(settings.milvus_kp_collection)
                res = _do()
            else:
                raise

        out: list[dict] = []
        for hit in res[0]:
            dist = float(hit.distance)
            out.append({"kp_id": int(hit["kp_id"]), "score": 1.0 - dist})
        return out
