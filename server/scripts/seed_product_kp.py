"""把 product_kp（课程编排）按 KpProductLink 现有数据一次性灌入。

本期 admin 没做"挂载 KP"UI，先用此脚本把每个 product 现有关联的 approved KP
按 KpRegistry.id 顺序写进 product_kp，order_index 从 0 递增。

跑法（在 server/ 目录下）：
    uv run python -m scripts.seed_product_kp                # 所有 product
    uv run python -m scripts.seed_product_kp --product zeekr007
    uv run python -m scripts.seed_product_kp --product-id 1
    uv run python -m scripts.seed_product_kp --reset        # 先清空再灌（含软删除项）

幂等：默认追加缺失项；已存在的 (product_id, kp_id) 不会重复插入，复活已软删项。
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import (  # noqa: E402
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    ProductKp,
    SyncSessionLocal,
)


def _seed_for_product(session, product: Product, reset: bool) -> dict:
    if reset:
        session.execute(
            ProductKp.__table__.delete().where(ProductKp.product_id == product.id)
        )

    # 当前活跃挂载
    rows = session.execute(
        select(ProductKp).where(ProductKp.product_id == product.id)
    ).scalars().all()
    by_kp = {r.kp_id: r for r in rows}

    # 来源：该 product 下 approved KP（来自 KpProductLink）
    source_kp_ids = list(
        session.execute(
            select(KpRegistry.id)
            .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
            .where(KpProductLink.product_id == product.id)
            .where(KpRegistry.status == KpStatus.approved)
            .order_by(KpRegistry.id)
        ).scalars().all()
    )

    added = 0
    revived = 0
    for idx, kp_id in enumerate(source_kp_ids):
        existing = by_kp.get(kp_id)
        if existing is None:
            session.add(ProductKp(product_id=product.id, kp_id=kp_id, order_index=idx))
            added += 1
        else:
            if existing.removed_at is not None:
                existing.removed_at = None
                revived += 1
            existing.order_index = idx

    session.commit()
    return {
        "product_id": product.id,
        "code": product.code,
        "name": product.name,
        "total_source_kps": len(source_kp_ids),
        "added": added,
        "revived": revived,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--product", help="按 product.code 限定")
    parser.add_argument("--product-id", type=int, help="按 product.id 限定")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="清空该 product 现有 product_kp（含软删除），重新灌入",
    )
    args = parser.parse_args()

    with SyncSessionLocal() as session:
        stmt = select(Product)
        if args.product_id is not None:
            stmt = stmt.where(Product.id == args.product_id)
        elif args.product:
            stmt = stmt.where(Product.code == args.product)
        products = session.execute(stmt).scalars().all()
        if not products:
            print("未匹配到任何 product")
            return 1

        for p in products:
            report = _seed_for_product(session, p, args.reset)
            print(
                f"[{report['code']}] {report['name']}: "
                f"来源 KP={report['total_source_kps']}, 新增={report['added']}, 复活={report['revived']}"
            )

    print(f"完成 @ {datetime.utcnow().isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
