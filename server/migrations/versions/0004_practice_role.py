"""add practice_role

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practice_role",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("name", sa.String(64), nullable=False, server_default=""),
        sa.Column("age", sa.Integer, nullable=False, server_default="35"),
        sa.Column("job", sa.String(128), nullable=False, server_default=""),
        sa.Column("city", sa.String(64), nullable=False, server_default=""),
        sa.Column("family", sa.String(255), nullable=False, server_default=""),
        sa.Column("budget", sa.String(128), nullable=False, server_default=""),
        sa.Column("tagline", sa.String(255), nullable=False, server_default=""),
        sa.Column("vibe", sa.String(64), nullable=False, server_default=""),
        sa.Column("emoji", sa.String(16), nullable=False, server_default="🙂"),
        sa.Column("avatar", sa.String(16), nullable=False, server_default="客"),
        sa.Column("avatar_color", sa.String(32), nullable=False, server_default="dark"),
        sa.Column("motivation", sa.Text, nullable=True),
        sa.Column("opener", sa.Text, nullable=True),
        sa.Column("context", sa.Text, nullable=True),
        sa.Column("prompt_seed", sa.Text, nullable=True),
        sa.Column("personality", sa.JSON, nullable=True),
        sa.Column("concerns", sa.JSON, nullable=True),
        sa.Column("mood", sa.JSON, nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="ai"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_practice_role_product", "practice_role", ["product_id"])

    # 「每个 product 至多一个 is_default=true」用生成列 + 唯一索引强制：
    # default_product_id = CASE WHEN is_default THEN product_id ELSE NULL END
    # NULL 不参与唯一索引，所以非 default 的行可以无限多。
    op.execute(
        "ALTER TABLE practice_role "
        "ADD COLUMN default_product_id BIGINT "
        "GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN product_id ELSE NULL END) VIRTUAL"
    )
    op.create_index(
        "uq_practice_role_default_per_product",
        "practice_role",
        ["default_product_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_practice_role_default_per_product", table_name="practice_role")
    op.execute("ALTER TABLE practice_role DROP COLUMN default_product_id")
    op.drop_index("ix_practice_role_product", table_name="practice_role")
    op.drop_table("practice_role")
