"""add product.features_brief + allow_experience_answer

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # MySQL 不允许 TEXT/BLOB 列带 DEFAULT，先以 nullable 加列再回填、最后改为 NOT NULL
    op.add_column(
        "product",
        sa.Column("features_brief", sa.Text(), nullable=True),
    )
    op.execute("UPDATE product SET features_brief = '' WHERE features_brief IS NULL")
    op.alter_column("product", "features_brief", existing_type=sa.Text(), nullable=False)
    op.add_column(
        "product",
        sa.Column(
            "allow_experience_answer",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )


def downgrade() -> None:
    op.drop_column("product", "allow_experience_answer")
    op.drop_column("product", "features_brief")
