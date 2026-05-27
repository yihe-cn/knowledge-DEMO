"""add course assignment

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_assignment",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "learner_id",
            sa.BigInteger,
            sa.ForeignKey("learner.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("assigned_at", sa.DateTime, nullable=True),
        sa.Column("revoked_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "product_id",
            "learner_id",
            name="uq_course_assignment_product_learner",
        ),
    )
    op.create_index("ix_course_assignment_product", "course_assignment", ["product_id"])
    op.create_index("ix_course_assignment_learner", "course_assignment", ["learner_id"])
    op.create_index("ix_course_assignment_status", "course_assignment", ["status"])


def downgrade() -> None:
    op.drop_index("ix_course_assignment_status", table_name="course_assignment")
    op.drop_index("ix_course_assignment_learner", table_name="course_assignment")
    op.drop_index("ix_course_assignment_product", table_name="course_assignment")
    op.drop_table("course_assignment")
