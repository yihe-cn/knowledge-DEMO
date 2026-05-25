"""init kb schema

Revision ID: 0001
Revises:
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kb_document",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("source_path", sa.String(1024), nullable=False),
        sa.Column("mime", sa.String(128), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("chunk_count", sa.Integer, nullable=False, server_default="0"),
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
        "kb_chunk",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("doc_id", sa.BigInteger, sa.ForeignKey("kb_document.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("token_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("meta", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("doc_id", "chunk_index", name="uq_chunk_doc_idx"),
    )
    op.create_index("ix_kb_chunk_doc_id", "kb_chunk", ["doc_id"])

    op.create_table(
        "kp_registry",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("definition", sa.Text, nullable=True),
        sa.Column("category", sa.String(128), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="llm"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_kp_status", "kp_registry", ["status"])

    op.create_table(
        "kp_chunk_link",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("kp_id", sa.BigInteger, sa.ForeignKey("kp_registry.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_id", sa.BigInteger, sa.ForeignKey("kb_chunk.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relevance", sa.Float, nullable=False, server_default="0"),
        sa.Column("source", sa.String(16), nullable=False, server_default="llm"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("kp_id", "chunk_id", name="uq_kp_chunk"),
    )
    op.create_index("ix_kp_chunk_link_kp", "kp_chunk_link", ["kp_id"])
    op.create_index("ix_kp_chunk_link_chunk", "kp_chunk_link", ["chunk_id"])

    op.create_table(
        "kp_extraction_job",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("doc_id", sa.BigInteger, sa.ForeignKey("kb_document.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("candidate_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("new_kp_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("raw_output", sa.JSON, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_kp_extraction_job_doc", "kp_extraction_job", ["doc_id"])


def downgrade() -> None:
    op.drop_table("kp_extraction_job")
    op.drop_table("kp_chunk_link")
    op.drop_table("kp_registry")
    op.drop_table("kb_chunk")
    op.drop_table("kb_document")
