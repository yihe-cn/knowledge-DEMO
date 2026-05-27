"""产品（Product）管理。学员端 productCatalog 在后台的镜像。"""
from __future__ import annotations

import os
import shutil
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    KbDocument,
    KpCardContent,
    KpChunkLink,
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    ProductKp,
    ProductStatus,
    get_session,
)
from .kp import _card_to_out
from ..schemas import ProductCreate, ProductKpBindRequest, ProductPatch

router = APIRouter()


_COVER_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "products")
_ALLOWED_COVER_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _product_to_dict(p: Product, kp_count: int = 0, doc_count: int = 0) -> dict[str, Any]:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "industry": p.industry,
        "student_role": p.student_role,
        "customer_label": p.customer_label,
        "description": p.description or "",
        "features_brief": p.features_brief or "",
        "allow_experience_answer": bool(p.allow_experience_answer),
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "kp_count": kp_count,
        "doc_count": doc_count,
        "pass_score": int(getattr(p, "pass_score", 70) or 70),
        "cover_image_url": getattr(p, "cover_image_url", None),
    }


@router.get("/products")
async def list_products(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    products = (
        await session.execute(select(Product).order_by(Product.id))
    ).scalars().all()

    kp_by_product: dict[int, set[int]] = {}
    link_rows = (
        await session.execute(select(KpProductLink.product_id, KpProductLink.kp_id))
    ).all()
    curriculum_rows = (
        await session.execute(select(ProductKp.product_id, ProductKp.kp_id))
    ).all()
    for pid, kid in [*link_rows, *curriculum_rows]:
        kp_by_product.setdefault(int(pid), set()).add(int(kid))
    doc_counts = dict(
        (
            await session.execute(
                select(KbDocument.product_id, func.count(KbDocument.id))
                .where(KbDocument.product_id.is_not(None))
                .group_by(KbDocument.product_id)
            )
        ).all()
    )
    return {
        "items": [
            _product_to_dict(
                p,
                kp_count=len(kp_by_product.get(p.id, set())),
                doc_count=int(doc_counts.get(p.id, 0)),
            )
            for p in products
        ]
    }


@router.post("/products")
async def create_product(
    body: ProductCreate, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    existing = (
        await session.execute(select(Product).where(Product.code == body.code))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"code {body.code} 已存在")
    p = Product(
        code=body.code,
        name=body.name,
        industry=body.industry,
        student_role=body.student_role,
        customer_label=body.customer_label,
        description=body.description,
        features_brief=body.features_brief,
        allow_experience_answer=body.allow_experience_answer,
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return _product_to_dict(p)


@router.patch("/products/{product_id}")
async def patch_product(
    product_id: int, body: ProductPatch, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    if body.code is not None and body.code != p.code:
        existing = (
            await session.execute(select(Product).where(Product.code == body.code))
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(400, f"code {body.code} 已存在")
        p.code = body.code
    if body.name is not None:
        p.name = body.name
    if body.industry is not None:
        p.industry = body.industry
    if body.student_role is not None:
        p.student_role = body.student_role
    if body.customer_label is not None:
        p.customer_label = body.customer_label
    if body.description is not None:
        p.description = body.description
    if body.features_brief is not None:
        p.features_brief = body.features_brief
    if body.allow_experience_answer is not None:
        p.allow_experience_answer = bool(body.allow_experience_answer)
    if body.status is not None:
        p.status = ProductStatus(body.status)
    if body.pass_score is not None:
        p.pass_score = int(body.pass_score)
    await session.commit()
    await session.refresh(p)
    return _product_to_dict(p)


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """软删除课程。

    Product 被学员进度、分发、文档和 KP 编排引用，直接物理删除会破坏历史数据；
    这里统一归档，学员端公开课程接口只展示 active 课程。
    """
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    p.status = ProductStatus.archived
    await session.commit()
    await session.refresh(p)
    return _product_to_dict(p)


@router.get("/products/{product_id}/kps")
async def list_product_kps(
    product_id: int,
    status: str | None = Query(None),
    include_removed_curriculum: bool = Query(
        False,
        description="包含 product_kp 中已从课程软移除的历史 KP，用于课程内重新添加",
    ),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if include_removed_curriculum:
        link_ids = set(
            (await session.execute(
                select(KpProductLink.kp_id).where(KpProductLink.product_id == product_id)
            )).scalars().all()
        )
        curriculum_ids = set(
            (await session.execute(
                select(ProductKp.kp_id).where(ProductKp.product_id == product_id)
            )).scalars().all()
        )
        kp_ids = link_ids | curriculum_ids
        if not kp_ids:
            return {"items": []}

        stmt = (
            select(KpRegistry, KpCardContent)
            .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
            .where(KpRegistry.id.in_(kp_ids))
            .order_by(desc(KpRegistry.id))
            .offset(offset)
            .limit(limit)
        )
        if status:
            stmt = stmt.where(KpRegistry.status == status)
        rows = (await session.execute(stmt)).all()
        return {
            "items": [
                {
                    "id": k.id,
                    "name": k.name,
                    "definition": k.definition,
                    "category": k.category,
                    "status": k.status.value if hasattr(k.status, "value") else str(k.status),
                    "version": k.version,
                    "card": _card_to_out(card),
                }
                for k, card in rows
            ]
        }

    stmt = (
        select(KpRegistry, KpCardContent)
        .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
        .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
        .where(KpProductLink.product_id == product_id)
        .order_by(desc(KpRegistry.id))
        .offset(offset)
        .limit(limit)
    )
    if status:
        stmt = stmt.where(KpRegistry.status == status)
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": k.id,
                "name": k.name,
                "definition": k.definition,
                "category": k.category,
                "status": k.status.value if hasattr(k.status, "value") else str(k.status),
                "version": k.version,
                "card": _card_to_out(card),
            }
            for k, card in rows
        ]
    }


# ── 学习闭环：product 课程编排（product_kp）─────────────
@router.get("/products/{product_id}/curriculum")
async def list_product_curriculum(
    product_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """列出 product 当前课程编排（已剔除软删除），按 order_index 排序。"""
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    rows = (
        await session.execute(
            select(ProductKp, KpRegistry, KpCardContent)
            .join(KpRegistry, KpRegistry.id == ProductKp.kp_id)
            .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
            .where(ProductKp.product_id == product_id)
            .where(ProductKp.removed_at.is_(None))
            .order_by(ProductKp.order_index, ProductKp.id)
        )
    ).all()
    kp_ids = [k.id for _, k, _ in rows]
    chunk_counts: dict[int, int] = {}
    if kp_ids:
        cc = await session.execute(
            select(KpChunkLink.kp_id, func.count(KpChunkLink.id))
            .where(KpChunkLink.kp_id.in_(kp_ids))
            .group_by(KpChunkLink.kp_id)
        )
        chunk_counts = {int(k): int(c) for k, c in cc.all()}
    return {
        "items": [
            {
                "kp_id": k.id,
                "id": k.id,
                "order_index": pk.order_index,
                "name": k.name,
                "definition": k.definition,
                "category": k.category,
                "status": k.status.value if hasattr(k.status, "value") else str(k.status),
                "version": k.version,
                "chunk_count": chunk_counts.get(k.id, 0),
                "exam_status": (
                    card.exam_status.value
                    if card and hasattr(card.exam_status, "value")
                    else (str(card.exam_status) if card else "pending")
                ),
                "curriculum_status": "active",
                "card": _card_to_out(card),
            }
            for pk, k, card in rows
        ]
    }


@router.put("/products/{product_id}/curriculum")
async def set_product_curriculum(
    product_id: int,
    body: ProductKpBindRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """全量替换 product 的课程编排。
    - 入参 kp_ids 顺序即为 order_index。
    - 旧的不在新列表里的，软删除（removed_at=now）。
    - 新加入的若历史上有软删记录，复活并更新 order_index。
    """
    from datetime import datetime

    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")

    new_ids = list(dict.fromkeys(body.kp_ids))
    # 校验 KP 存在
    if new_ids:
        existing_kp = set(
            (
                await session.execute(
                    select(KpRegistry.id).where(KpRegistry.id.in_(new_ids))
                )
            ).scalars().all()
        )
        missing = [i for i in new_ids if i not in existing_kp]
        if missing:
            raise HTTPException(400, f"kp_ids 不存在: {missing}")

    # 加载现有所有挂载（含软删除），便于复活/软删
    rows = (
        await session.execute(
            select(ProductKp).where(ProductKp.product_id == product_id)
        )
    ).scalars().all()
    by_kp: dict[int, ProductKp] = {r.kp_id: r for r in rows}

    now = datetime.utcnow()
    new_set = set(new_ids)

    # 软删除：当前 active 但不在新列表
    for r in rows:
        if r.kp_id not in new_set and r.removed_at is None:
            r.removed_at = now

    # 新增 / 复活
    for idx, kp_id in enumerate(new_ids):
        existing = by_kp.get(kp_id)
        if existing is None:
            session.add(
                ProductKp(product_id=product_id, kp_id=kp_id, order_index=idx)
            )
        else:
            existing.order_index = idx
            existing.removed_at = None

    await session.commit()
    return {"ok": True, "kp_ids": new_ids}


@router.delete("/products/{product_id}/curriculum/{kp_id}")
async def remove_product_curriculum_kp(
    product_id: int, kp_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """仅从课程编排移除 KP，不删除 KP↔Product 的知识归属关系。"""
    from datetime import datetime

    pk = (
        await session.execute(
            select(ProductKp)
            .where(ProductKp.product_id == product_id)
            .where(ProductKp.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    if pk is not None and pk.removed_at is None:
        pk.removed_at = datetime.utcnow()
    await session.commit()
    return {"ok": True, "product_id": product_id, "kp_id": kp_id}


@router.get("/products/{product_id}/documents")
async def list_product_documents(
    product_id: int,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    rows = (
        await session.execute(
            select(KbDocument)
            .where(KbDocument.product_id == product_id)
            .order_by(desc(KbDocument.id))
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return {
        "items": [
            {
                "id": d.id,
                "file_name": d.file_name,
                "status": d.status.value if hasattr(d.status, "value") else str(d.status),
                "chunk_count": d.chunk_count,
                "created_at": d.created_at.isoformat() if d.created_at else "",
            }
            for d in rows
        ]
    }


@router.post("/products/{product_id}/cover-image")
async def upload_product_cover(
    product_id: int,
    request: Request,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """上传产品封面图；自动覆盖旧封面。"""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_COVER_EXTS:
        raise HTTPException(400, "不支持的图片格式，请使用 jpg/png/webp")
    p = await session.get(Product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    os.makedirs(_COVER_UPLOAD_DIR, exist_ok=True)
    filename = f"{product_id}_{uuid.uuid4().hex}{ext}"
    dest = os.path.join(_COVER_UPLOAD_DIR, filename)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    rel_path = f"/uploads/products/{filename}"
    p.cover_image_url = rel_path
    await session.commit()
    base = str(request.base_url).rstrip("/")
    return {"cover_image_url": rel_path, "url": f"{base}{rel_path}"}
