"""add product + kp_product_link, kb_document.product_id

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("industry", sa.String(64), nullable=False, server_default=""),
        sa.Column("student_role", sa.String(64), nullable=False, server_default=""),
        sa.Column("customer_label", sa.String(64), nullable=False, server_default=""),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "kp_product_link",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "kp_id",
            sa.BigInteger,
            sa.ForeignKey("kp_registry.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source", sa.String(16), nullable=False, server_default="auto"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("kp_id", "product_id", name="uq_kp_product"),
    )
    op.create_index("ix_kp_product_link_kp", "kp_product_link", ["kp_id"])
    op.create_index("ix_kp_product_link_product", "kp_product_link", ["product_id"])

    op.add_column(
        "kb_document",
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_kb_document_product_id", "kb_document", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_kb_document_product_id", table_name="kb_document")
    op.drop_constraint(None, "kb_document", type_="foreignkey")
    op.drop_column("kb_document", "product_id")
    op.drop_index("ix_kp_product_link_product", table_name="kp_product_link")
    op.drop_index("ix_kp_product_link_kp", table_name="kp_product_link")
    op.drop_table("kp_product_link")
    op.drop_table("product")
