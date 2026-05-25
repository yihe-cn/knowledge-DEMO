"""把本地 MySQL + Milvus standalone 的数据导出成 SQLite + Milvus Lite，
作为 Docker demo 镜像的初始数据。

用法（在 server/ 目录跑）：
    python scripts/export_seed.py \\
        --mysql-dsn "mysql+pymysql://root:simugo@127.0.0.1:3306/simugo_kb" \\
        --milvus-uri http://127.0.0.1:19530 \\
        --out-dir ./seed

输出：
    ./seed/app.db          # SQLite，与镜像里 /data/app.db 同 schema
    ./seed/milvus.db       # Milvus Lite，与镜像里 /data/milvus.db 同 schema

之后 `docker build` 会把整个 ./seed 拷到镜像 /seed/，entrypoint 首次启动时
自动 cp 到 /data。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 让脚本可以独立运行：把 server/ 加进 sys.path
SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))


def export_relational(src_dsn: str, out_path: Path) -> None:
    """逐表把 MySQL 数据拷到 SQLite。

    用 SQLAlchemy ORM models 建 SQLite schema，避免 MySQL 特有的生成列 / ENUM
    类型差异。然后用 SQLAlchemy core 按表 SELECT + INSERT，类型自动转换。
    """
    from sqlalchemy import create_engine, MetaData, Table, select, insert

    from app.db import Base  # ORM 定义里的所有表

    print(f"[mysql] source: {src_dsn}")
    src = create_engine(src_dsn, pool_pre_ping=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    dst_url = f"sqlite:///{out_path.absolute()}"
    print(f"[sqlite] target: {dst_url}")
    dst = create_engine(dst_url)

    # 1) 在 SQLite 里建表（用 ORM 定义，不要从 MySQL 反射 schema，避免生成列）
    Base.metadata.create_all(dst)

    # 2) 拿源库实际 schema，按 ORM 表名挨个拷数据
    src_meta = MetaData()
    src_meta.reflect(bind=src)

    # 拷贝顺序按外键依赖排：product → practice_role → kb_document → kb_chunk →
    # kp_registry → kp_chunk_link → kp_product_link → kp_extraction_job
    # SQLAlchemy 的 sorted_tables 已经处理好依赖
    for table in Base.metadata.sorted_tables:
        name = table.name
        if name not in src_meta.tables:
            print(f"  skip {name} (not in source)")
            continue
        src_table = src_meta.tables[name]
        # 取源表里两边都有的列（忽略 MySQL 生成列 default_product_id 等）
        common_cols = [c.name for c in table.columns if c.name in src_table.columns]

        with src.connect() as sc:
            rows = sc.execute(select(*[src_table.c[col] for col in common_cols])).fetchall()
        if not rows:
            print(f"  {name}: 0 rows")
            continue
        # 转成 dict 列表
        data = [dict(zip(common_cols, r)) for r in rows]
        with dst.begin() as dc:
            dc.execute(insert(table), data)
        print(f"  {name}: {len(rows)} rows")

    src.dispose()
    dst.dispose()


def export_vectors(src_uri: str, out_path: Path, collection: str = "kb_chunks") -> None:
    """从 Milvus standalone 把 kb_chunks 集合搬到 Milvus Lite。"""
    from pymilvus import DataType, MilvusClient

    print(f"[milvus] source: {src_uri}, collection={collection}")
    src = MilvusClient(uri=src_uri)
    if not src.has_collection(collection):
        print("  collection not found, skip")
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    print(f"[milvus-lite] target: {out_path}")
    dst = MilvusClient(uri=str(out_path.absolute()))

    # 取 dim：从源 schema 拿
    src_desc = src.describe_collection(collection)
    dim = None
    for f in src_desc["fields"]:
        if f["name"] == "vector":
            dim = f["params"]["dim"]
    if not dim:
        raise RuntimeError("source collection has no 'vector' field")
    print(f"  vector dim: {dim}")

    # 建目标 collection：FLAT 索引（Lite 限制）
    schema = dst.create_schema(auto_id=False, enable_dynamic_field=False)
    schema.add_field("chunk_id", DataType.INT64, is_primary=True)
    schema.add_field("doc_id", DataType.INT64)
    schema.add_field("kp_ids", DataType.ARRAY, element_type=DataType.INT64, max_capacity=32)
    schema.add_field("vector", DataType.FLOAT_VECTOR, dim=dim)

    idx = dst.prepare_index_params()
    idx.add_index(field_name="vector", index_type="FLAT", metric_type="COSINE")
    dst.create_collection(collection_name=collection, schema=schema, index_params=idx)

    # 分页拉取（query iterator 在 standalone 上更稳）
    total = 0
    batch_size = 1000
    iterator = src.query_iterator(
        collection_name=collection,
        batch_size=batch_size,
        output_fields=["chunk_id", "doc_id", "kp_ids", "vector"],
    )
    while True:
        batch = iterator.next()
        if not batch:
            break
        # 把 numpy / list 都标准化
        rows = []
        for r in batch:
            rows.append(
                {
                    "chunk_id": int(r["chunk_id"]),
                    "doc_id": int(r.get("doc_id") or 0),
                    "kp_ids": list(r.get("kp_ids") or []),
                    "vector": list(r["vector"]),
                }
            )
        dst.upsert(collection_name=collection, data=rows)
        total += len(rows)
        print(f"  copied {total} ...")
    iterator.close()
    print(f"  done. total {total} vectors")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--mysql-dsn",
        default=os.environ.get(
            "EXPORT_MYSQL_DSN",
            "mysql+pymysql://root:simugo@127.0.0.1:3306/simugo_kb",
        ),
    )
    p.add_argument(
        "--milvus-uri",
        default=os.environ.get("EXPORT_MILVUS_URI", "http://127.0.0.1:19530"),
    )
    p.add_argument("--out-dir", default="./seed")
    p.add_argument("--collection", default="kb_chunks")
    args = p.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    export_relational(args.mysql_dsn, out_dir / "app.db")
    export_vectors(args.milvus_uri, out_dir / "milvus.db", args.collection)

    print(f"\n✓ seed written to {out_dir}")
    for f in sorted(out_dir.iterdir()):
        print(f"  {f.name}  {f.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
