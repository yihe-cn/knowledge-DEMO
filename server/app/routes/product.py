"""产品（Product）管理。学员端 productCatalog 在后台的镜像。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    KbDocument,
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    ProductStatus,
    get_session,
)
from ..schemas import ProductCreate, ProductPatch

router = APIRouter()


def _product_to_dict(p: Product, kp_count: int = 0, doc_count: int = 0) -> dict[str, Any]:
    return {
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "industry": p.industry,
        "student_role": p.student_role,
        "customer_label": p.customer_label,
        "description": p.description or "",
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "kp_count": kp_count,
        "doc_count": doc_count,
    }


@router.get("/products")
async def list_products(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    products = (
        await session.execute(select(Product).order_by(Product.id))
    ).scalars().all()

    kp_counts = dict(
        (
            await session.execute(
                select(KpProductLink.product_id, func.count(KpProductLink.id)).group_by(
                    KpProductLink.product_id
                )
            )
        ).all()
    )
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
                kp_count=int(kp_counts.get(p.id, 0)),
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
    if body.status is not None:
        p.status = ProductStatus(body.status)
    await session.commit()
    await session.refresh(p)
    return _product_to_dict(p)


@router.get("/products/{product_id}/kps")
async def list_product_kps(
    product_id: int,
    status: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = (
        select(KpRegistry)
        .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
        .where(KpProductLink.product_id == product_id)
        .order_by(desc(KpRegistry.id))
        .offset(offset)
        .limit(limit)
    )
    if status:
        stmt = stmt.where(KpRegistry.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": k.id,
                "name": k.name,
                "definition": k.definition,
                "category": k.category,
                "status": k.status.value if hasattr(k.status, "value") else str(k.status),
                "version": k.version,
            }
            for k in rows
        ]
    }


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
