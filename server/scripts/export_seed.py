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


def _get_vector_dim(src, collection: str) -> int:
    src_desc = src.describe_collection(collection)
    for f in src_desc["fields"]:
        if f["name"] == "vector":
            return int(f["params"]["dim"])
    raise RuntimeError(f"source collection {collection} has no 'vector' field")


def _copy_collection(
    src,
    dst,
    collection: str,
    output_fields: list[str],
    schema_fields: list[tuple],
    dim: int,
) -> int:
    """通用 collection 拷贝：建目标 schema + FLAT 索引，分页 query + upsert。
    schema_fields: [(name, DataType, kwargs), ...]"""
    from pymilvus import DataType

    schema = dst.create_schema(auto_id=False, enable_dynamic_field=False)
    for name, dtype, kwargs in schema_fields:
        schema.add_field(name, dtype, **kwargs)
    schema.add_field("vector", DataType.FLOAT_VECTOR, dim=dim)

    idx = dst.prepare_index_params()
    idx.add_index(field_name="vector", index_type="FLAT", metric_type="COSINE")
    dst.create_collection(collection_name=collection, schema=schema, index_params=idx)

    total = 0
    iterator = src.query_iterator(
        collection_name=collection,
        batch_size=1000,
        output_fields=output_fields,
    )
    while True:
        batch = iterator.next()
        if not batch:
            break
        rows = []
        for r in batch:
            row = {"vector": list(r["vector"])}
            for fname in output_fields:
                if fname == "vector":
                    continue
                v = r.get(fname)
                if isinstance(v, list):
                    row[fname] = list(v)
                elif v is None:
                    row[fname] = 0
                else:
                    row[fname] = int(v) if isinstance(v, (int, bool)) or str(v).lstrip("-").isdigit() else v
            rows.append(row)
        dst.upsert(collection_name=collection, data=rows)
        total += len(rows)
        print(f"  {collection}: copied {total} ...")
    iterator.close()
    return total


def export_vectors(
    src_uri: str,
    out_path: Path,
    chunk_collection: str = "kb_chunks",
    kp_collection: str = "kp_embeddings",
) -> None:
    """从 Milvus standalone 把 kb_chunks + kp_embeddings 两个集合搬到 Milvus Lite。"""
    from pymilvus import DataType, MilvusClient

    print(f"[milvus] source: {src_uri}")
    src = MilvusClient(uri=src_uri)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        # MilvusClient 在打开已存在但 schema 旧的文件时会冲突，整个清掉重建最干净
        if out_path.is_dir():
            import shutil
            shutil.rmtree(out_path)
        else:
            out_path.unlink()
    print(f"[milvus-lite] target: {out_path}")
    dst = MilvusClient(uri=str(out_path.absolute()))

    # kb_chunks
    if src.has_collection(chunk_collection):
        dim = _get_vector_dim(src, chunk_collection)
        print(f"  {chunk_collection}: vector dim {dim}")
        n = _copy_collection(
            src,
            dst,
            chunk_collection,
            output_fields=["chunk_id", "doc_id", "kp_ids", "vector"],
            schema_fields=[
                ("chunk_id", DataType.INT64, {"is_primary": True}),
                ("doc_id", DataType.INT64, {}),
                (
                    "kp_ids",
                    DataType.ARRAY,
                    {"element_type": DataType.INT64, "max_capacity": 32},
                ),
            ],
            dim=dim,
        )
        print(f"  {chunk_collection}: done. total {n}")
    else:
        print(f"  {chunk_collection}: not found in source, skip")

    # kp_embeddings
    if src.has_collection(kp_collection):
        dim = _get_vector_dim(src, kp_collection)
        print(f"  {kp_collection}: vector dim {dim}")
        n = _copy_collection(
            src,
            dst,
            kp_collection,
            output_fields=["kp_id", "status", "vector"],
            schema_fields=[
                ("kp_id", DataType.INT64, {"is_primary": True}),
                ("status", DataType.INT8, {}),
            ],
            dim=dim,
        )
        print(f"  {kp_collection}: done. total {n}")
    else:
        print(f"  {kp_collection}: not found in source, skip")


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
    p.add_argument("--kp-collection", default="kp_embeddings")
    args = p.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    export_relational(args.mysql_dsn, out_dir / "app.db")
    export_vectors(
        args.milvus_uri,
        out_dir / "milvus.db",
        chunk_collection=args.collection,
        kp_collection=args.kp_collection,
    )

    print(f"\n✓ seed written to {out_dir}")
    for f in sorted(out_dir.iterdir()):
        print(f"  {f.name}  {f.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
