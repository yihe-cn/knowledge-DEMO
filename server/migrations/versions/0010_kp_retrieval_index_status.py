"""KP 召回索引可观测 + 防覆盖：retrieval_index_status / retrieval_index_error / retrieval_content_hash

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-27

针对 0009 引入的 KP 富化召回链路补三件事：
1. retrieval_index_status / retrieval_index_error：让 reindex 失败不再静默吞掉，管理员能在 UI 上看到
2. retrieval_content_hash：reindex 写入前比对当前内容 hash，防止并发竞态下旧任务覆盖新向量

MySQL TEXT 不支持 DEFAULT；status 用 VARCHAR(16) + server_default=pending 兜底。
"""
from alembic import op
import sqlalchemy as sa


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("kp_card_content") as batch:
        batch.add_column(
            sa.Column(
                "retrieval_index_status",
                sa.String(16),
                nullable=False,
                server_default="pending",
            )
        )
        batch.add_column(sa.Column("retrieval_index_error", sa.Text, nullable=True))
        batch.add_column(sa.Column("retrieval_content_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("kp_card_content") as batch:
        batch.drop_column("retrieval_content_hash")
        batch.drop_column("retrieval_index_error")
        batch.drop_column("retrieval_index_status")
