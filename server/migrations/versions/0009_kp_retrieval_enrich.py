"""KP 召回富化：KpCardContent 加 trigger_questions / aliases / scenario / retrieval_indexed_at

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-27

新增字段用于把 KP 自身送进 Milvus kp_embeddings collection 参与召回，
让"方法论命名 + 业务场景化 query"的语义鸿沟问题缓解。
MySQL TEXT/JSON 不支持 DEFAULT，统一 nullable=True，读路径用 `or []` / `or ""` 兜底。
"""
from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("kp_card_content") as batch:
        batch.add_column(sa.Column("trigger_questions", sa.JSON, nullable=True))
        batch.add_column(sa.Column("aliases", sa.JSON, nullable=True))
        batch.add_column(sa.Column("scenario", sa.Text, nullable=True))
        batch.add_column(sa.Column("retrieval_indexed_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("kp_card_content") as batch:
        batch.drop_column("retrieval_indexed_at")
        batch.drop_column("scenario")
        batch.drop_column("aliases")
        batch.drop_column("trigger_questions")
