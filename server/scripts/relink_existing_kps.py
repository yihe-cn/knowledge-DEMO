"""一次性脚本：为已有 KP 反向补建到 chunks 的 KpChunkLink。

适用场景：ingest 文档时 trigger_kp_extraction=False（PAX 场景）
或 ingest 后 extract 未命中所有现有 KP（007 场景）。

策略：
  - 对每个 product 的每个 approved KP
  - embed (name + " " + definition)
  - Milvus 在该 product 的 doc_ids 范围内 top-K 搜索 kb_chunks
  - 命中阈值以上写 KpChunkLink(source=auto-relink, relevance=score)
  - 收集 affected chunks 批量 update_kp_ids 回写 Milvus

用法：
  cd server && uv run python -m scripts.relink_existing_kps --product zeekr007 --top-k 8 --threshold 0.55
  cd server && uv run python -m scripts.relink_existing_kps --product pax --top-k 8 --threshold 0.55
"""

from __future__ import annotations

import argparse
import sys
from typing import Iterable

from sqlalchemy import select

from app.db import SyncSessionLocal
from app.db.models import (
    KpRegistry,
    KpProductLink,
    KpChunkLink,
    KpStatus,
    LinkSource,
    Product,
    KbDocument,
)
from app.embeddings import embed_sync
from app.vector_store import search as milvus_search, update_kp_ids


def _make_sync_session():
    return SyncSessionLocal()


def relink_product(product_code: str, top_k: int, threshold: float) -> None:
    session = _make_sync_session()
    product = session.execute(
        select(Product).where(Product.code == product_code)
    ).scalar_one_or_none()
    if product is None:
        print(f"!! product {product_code} not found")
        return

    print(f"=== relinking product '{product_code}' (id={product.id}) ===")

    doc_ids = list(
        session.execute(
            select(KbDocument.id).where(KbDocument.product_id == product.id)
        ).scalars()
    )
    if not doc_ids:
        print("  no docs for this product, nothing to relink")
        return
    print(f"  doc_ids in scope: {len(doc_ids)} -> {doc_ids[:8]}{'...' if len(doc_ids)>8 else ''}")

    kps = list(
        session.execute(
            select(KpRegistry)
            .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
            .where(KpProductLink.product_id == product.id)
            .where(KpRegistry.status == KpStatus.approved)
        ).scalars()
    )
    print(f"  approved KPs to relink: {len(kps)}")
    if not kps:
        return

    total_links = 0
    affected_chunks: set[int] = set()
    skipped_existing = 0

    for kp in kps:
        text = (kp.name or "") + " " + (kp.definition or "")
        text = text.strip()
        if not text:
            continue
        vec = embed_sync([text])[0]
        hits = milvus_search(vec, top_k=top_k, doc_ids=doc_ids)
        added = 0
        for h in hits:
            if h["score"] < threshold:
                continue
            cid = h["chunk_id"]
            exists = session.execute(
                select(KpChunkLink).where(
                    KpChunkLink.kp_id == kp.id, KpChunkLink.chunk_id == cid
                )
            ).scalar_one_or_none()
            if exists:
                skipped_existing += 1
                continue
            session.add(
                KpChunkLink(
                    kp_id=kp.id,
                    chunk_id=cid,
                    relevance=float(h["score"]),
                    source=LinkSource.llm,
                )
            )
            affected_chunks.add(cid)
            added += 1
            total_links += 1
        print(f"  KP#{kp.id} '{kp.name[:30]}' +{added} (existing skipped: {skipped_existing})")

    session.commit()
    print(f"\n  total new links: {total_links}, affected chunks: {len(affected_chunks)}")

    # 回写 Milvus kb_chunks.kp_ids
    print("  rewriting Milvus kb_chunks.kp_ids ...")
    failed = 0
    for cid in sorted(affected_chunks):
        rows = session.execute(
            select(KpChunkLink.kp_id)
            .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
            .where(KpChunkLink.chunk_id == cid)
            .where(KpRegistry.status == KpStatus.approved)
        ).scalars().all()
        try:
            update_kp_ids(int(cid), [int(k) for k in rows])
        except Exception as e:
            failed += 1
            print(f"  !! chunk {cid} milvus update failed: {e}")
    print(f"  Milvus update done, failed: {failed}/{len(affected_chunks)}")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product", required=True, help="product code, e.g. pax or zeekr007")
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--threshold", type=float, default=0.55)
    args = parser.parse_args(argv)
    relink_product(args.product, args.top_k, args.threshold)
    return 0


if __name__ == "__main__":
    sys.exit(main())
