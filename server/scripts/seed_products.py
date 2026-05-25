"""产品种子 + 历史 KP 一键回填脚本。

跑法（在 server/ 目录下）：
    uv run python -m scripts.seed_products
或者：
    uv run python scripts/seed_products.py

幂等：用 code 查重，已存在不会重复插入。
"""
from __future__ import annotations

import sys
from pathlib import Path

# 让脚本能 import app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import (  # noqa: E402
    KbChunk,
    KbDocument,
    KpChunkLink,
    KpProductLink,
    Product,
    ProductLinkSource,
    SyncSessionLocal,
)


SEEDS = [
    {
        "code": "zeekr007",
        "name": "极氪 007",
        "industry": "汽车销售",
        "student_role": "销售顾问",
        "customer_label": "客户",
        "description": "极氪 007 销售顾问知识库",
    },
    {
        "code": "pax",
        "name": "宝怡乐 PAX®",
        "industry": "医药学术",
        "student_role": "医药代表",
        "customer_label": "医生",
        "description": "宝怡乐 PAX 医药学术拜访知识库",
    },
]


def ensure_products(session) -> dict[str, Product]:
    out: dict[str, Product] = {}
    for s in SEEDS:
        p = session.execute(select(Product).where(Product.code == s["code"])).scalar_one_or_none()
        if p is None:
            p = Product(**s)
            session.add(p)
            session.flush()
            print(f"[seed] created product id={p.id} code={p.code}")
        else:
            print(f"[seed] product exists id={p.id} code={p.code}")
        out[p.code] = p
    session.commit()
    return out


def backfill_doc_to_product(session, doc_id: int, product_id: int) -> tuple[int, int]:
    """把 doc 绑到 product，并把该 doc 下所有 KP 都补上 product link。返回 (kp_count, new_link_count)。"""
    doc = session.get(KbDocument, doc_id)
    if not doc:
        print(f"[backfill] doc {doc_id} 不存在，跳过")
        return 0, 0
    doc.product_id = product_id
    kp_ids = list(
        session.execute(
            select(KpChunkLink.kp_id)
            .join(KbChunk, KbChunk.id == KpChunkLink.chunk_id)
            .where(KbChunk.doc_id == doc_id)
            .distinct()
        ).scalars()
    )
    existing = set(
        session.execute(
            select(KpProductLink.kp_id)
            .where(KpProductLink.product_id == product_id)
            .where(KpProductLink.kp_id.in_(kp_ids) if kp_ids else False)
        ).scalars()
    )
    added = 0
    for kid in kp_ids:
        if kid in existing:
            continue
        session.add(KpProductLink(kp_id=kid, product_id=product_id, source=ProductLinkSource.auto))
        added += 1
    session.commit()
    print(f"[backfill] doc={doc_id} → product={product_id}: kp={len(kp_ids)} added={added}")
    return len(kp_ids), added


def main() -> None:
    with SyncSessionLocal() as session:
        products = ensure_products(session)
        # 把当前唯一的 PAX PPT (doc_id=1) 回填到 pax
        pax = products.get("pax")
        if pax:
            backfill_doc_to_product(session, doc_id=1, product_id=pax.id)


if __name__ == "__main__":
    main()
