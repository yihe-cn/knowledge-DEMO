"""add kp_card_content sidecar table

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kp_card_content",
        sa.Column(
            "kp_id",
            sa.BigInteger,
            sa.ForeignKey("kp_registry.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("tier", sa.String(16), nullable=False, server_default="detail"),
        sa.Column("spec", sa.Text, nullable=False),
        sa.Column("customer_voice", sa.Text, nullable=False),
        sa.Column("sources", sa.JSON, nullable=True),
        sa.Column("applies_to", sa.JSON, nullable=True),
        sa.Column("not_applicable", sa.JSON, nullable=True),
        sa.Column("rebuttals", sa.JSON, nullable=True),
        sa.Column("sales", sa.Text, nullable=False),
        sa.Column(
            "enrich_status", sa.String(16), nullable=False, server_default="pending"
        ),
        sa.Column("enrich_error", sa.Text, nullable=False),
        sa.Column("enriched_at", sa.DateTime, nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("kp_card_content")
