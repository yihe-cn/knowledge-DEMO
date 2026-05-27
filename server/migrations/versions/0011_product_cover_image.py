"""产品封面图：Product.cover_image_url

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-27
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("product") as batch:
        batch.add_column(sa.Column("cover_image_url", sa.String(500), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("product") as batch:
        batch.drop_column("cover_image_url")
