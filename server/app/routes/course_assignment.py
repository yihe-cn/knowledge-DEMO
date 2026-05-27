"""课程分发管理端 API。Product 作为课程实体，Learner 作为学员。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    CourseAssignment,
    CourseAssignmentStatus,
    Learner,
    Product,
    ProductStatus,
    get_session,
)
from ..schemas import CourseAssignmentCreate

router = APIRouter()


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _assignment_to_dict(
    a: CourseAssignment, product: Product | None = None, learner: Learner | None = None
) -> dict[str, Any]:
    return {
        "id": a.id,
        "product_id": a.product_id,
        "learner_id": a.learner_id,
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "assigned_at": _iso(a.assigned_at),
        "revoked_at": _iso(a.revoked_at),
        "created_at": _iso(a.created_at) or "",
        "updated_at": _iso(a.updated_at) or "",
        "product": {
            "id": product.id,
            "code": product.code,
            "name": product.name,
            "status": product.status.value if hasattr(product.status, "value") else str(product.status),
        } if product else None,
        "learner": {
            "id": learner.id,
            "name": learner.name,
            "dept": learner.dept or "",
            "external_ref": learner.external_ref or "",
        } if learner else None,
    }


@router.get("/admin/course-assignments")
async def list_course_assignments(
    product_id: int | None = Query(None),
    learner_id: int | None = Query(None),
    status: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = (
        select(CourseAssignment, Product, Learner)
        .join(Product, Product.id == CourseAssignment.product_id)
        .join(Learner, Learner.id == CourseAssignment.learner_id)
        .order_by(desc(CourseAssignment.id))
    )
    if product_id is not None:
        stmt = stmt.where(CourseAssignment.product_id == product_id)
    if learner_id is not None:
        stmt = stmt.where(CourseAssignment.learner_id == learner_id)
    if status:
        if status not in {s.value for s in CourseAssignmentStatus}:
            raise HTTPException(400, f"bad status {status}")
        stmt = stmt.where(CourseAssignment.status == CourseAssignmentStatus(status))

    rows = (await session.execute(stmt)).all()
    return {"items": [_assignment_to_dict(a, p, l) for a, p, l in rows]}


@router.post("/admin/course-assignments")
async def create_course_assignments(
    body: CourseAssignmentCreate, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    product = await session.get(Product, body.product_id)
    if not product:
        raise HTTPException(404, "product not found")
    if product.status != ProductStatus.active:
        raise HTTPException(400, "只能分发 active 课程")

    learner_ids = list(dict.fromkeys(body.learner_ids))
    if not learner_ids:
        raise HTTPException(400, "learner_ids 不能为空")

    learners = (
        await session.execute(select(Learner).where(Learner.id.in_(learner_ids)))
    ).scalars().all()
    learner_by_id = {int(l.id): l for l in learners}
    missing = [lid for lid in learner_ids if lid not in learner_by_id]
    if missing:
        raise HTTPException(400, f"部分 learner_id 不存在: {missing}")
    missing_refs = [
        learner_by_id[lid].name or f"#{lid}"
        for lid in learner_ids
        if not (learner_by_id[lid].external_ref or "").strip()
    ]
    if missing_refs:
        raise HTTPException(
            400,
            f"以下学员缺少账号标识，无法在学员端识别: {', '.join(missing_refs)}",
        )

    existing = (
        await session.execute(
            select(CourseAssignment)
            .where(CourseAssignment.product_id == body.product_id)
            .where(CourseAssignment.learner_id.in_(learner_ids))
        )
    ).scalars().all()
    existing_by_learner = {int(a.learner_id): a for a in existing}

    now = datetime.utcnow()
    touched: list[CourseAssignment] = []
    for learner_id in learner_ids:
        row = existing_by_learner.get(learner_id)
        if row:
            row.status = CourseAssignmentStatus.active
            row.assigned_at = now
            row.revoked_at = None
            touched.append(row)
            continue
        row = CourseAssignment(
            product_id=body.product_id,
            learner_id=learner_id,
            status=CourseAssignmentStatus.active,
            assigned_at=now,
        )
        session.add(row)
        touched.append(row)

    await session.commit()
    for row in touched:
        await session.refresh(row)

    return {
        "items": [
            _assignment_to_dict(row, product, learner_by_id.get(int(row.learner_id)))
            for row in touched
        ]
    }


@router.delete("/admin/course-assignments/{assignment_id}")
async def revoke_course_assignment(
    assignment_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    row = await session.get(CourseAssignment, assignment_id)
    if not row:
        raise HTTPException(404, "course assignment not found")
    row.status = CourseAssignmentStatus.revoked
    row.revoked_at = datetime.utcnow()
    await session.commit()
    await session.refresh(row)
    return _assignment_to_dict(row)
