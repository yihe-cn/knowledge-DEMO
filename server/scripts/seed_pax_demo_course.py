"""Prepare the PAX demo course and assign it to 李代表.

Run from server/:
    uv run python scripts/seed_pax_demo_course.py

This intentionally uses the existing ``pax`` Product instead of cloning it,
because PAX documents are bound to that product for RAG filtering.
"""
from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import (  # noqa: E402
    CourseAssignment,
    CourseAssignmentStatus,
    Learner,
    Product,
    ProductStatus,
    SyncSessionLocal,
)


PAX_PRODUCT = {
    "code": "pax",
    "name": "宝怡乐 PAX®",
    "industry": "医药学术",
    "student_role": "医药代表",
    "customer_label": "医生",
    "description": "宝怡乐 PAX 医药学术拜访知识库",
}

LI_REP = {
    "name": "李代表",
    "dept": "华东儿科组",
    "external_ref": "lidaibiao",
}


def ensure_pax_course(session) -> Product:
    product = session.execute(
        select(Product).where(Product.code == PAX_PRODUCT["code"])
    ).scalar_one_or_none()
    if product is None:
        product = Product(**PAX_PRODUCT, status=ProductStatus.active)
        session.add(product)
        session.flush()
        print(f"[seed] created PAX course id={product.id} code={product.code}")
    else:
        for key, value in PAX_PRODUCT.items():
            setattr(product, key, value)
        product.status = ProductStatus.active
        print(f"[seed] PAX course exists id={product.id} code={product.code}; ensured active")
    return product


def ensure_li_rep(session) -> Learner:
    learner = session.execute(
        select(Learner).where(Learner.external_ref == LI_REP["external_ref"])
    ).scalar_one_or_none()
    if learner is None:
        learner = session.execute(
            select(Learner).where(Learner.name == LI_REP["name"])
        ).scalar_one_or_none()
    if learner is None:
        learner = Learner(**LI_REP)
        session.add(learner)
        session.flush()
        print(f"[seed] created learner id={learner.id} name={learner.name}")
    else:
        learner.name = LI_REP["name"]
        learner.dept = LI_REP["dept"]
        learner.external_ref = LI_REP["external_ref"]
        print(f"[seed] learner exists id={learner.id} external_ref={learner.external_ref}")
    return learner


def ensure_assignment(session, product: Product, learner: Learner) -> CourseAssignment:
    assignment = session.execute(
        select(CourseAssignment)
        .where(CourseAssignment.product_id == product.id)
        .where(CourseAssignment.learner_id == learner.id)
    ).scalar_one_or_none()
    now = datetime.now(UTC).replace(tzinfo=None)
    if assignment is None:
        assignment = CourseAssignment(
            product_id=product.id,
            learner_id=learner.id,
            status=CourseAssignmentStatus.active,
            assigned_at=now,
        )
        session.add(assignment)
        session.flush()
        print(f"[seed] assigned course product_id={product.id} learner_id={learner.id}")
    else:
        assignment.status = CourseAssignmentStatus.active
        assignment.assigned_at = now
        assignment.revoked_at = None
        print(f"[seed] assignment exists id={assignment.id}; reactivated")
    return assignment


def main() -> None:
    with SyncSessionLocal() as session:
        product = ensure_pax_course(session)
        learner = ensure_li_rep(session)
        assignment = ensure_assignment(session, product, learner)
        session.commit()

        print("\n[done] PAX demo course is ready")
        print(f"course: {product.name} ({product.code})")
        print(f"learner: {learner.name} ({learner.external_ref})")
        print(f"assignment_id: {assignment.id}")
        print("practice_url: http://localhost:5173/?account=lidaibiao&product=pax&route=practice")


if __name__ == "__main__":
    main()
