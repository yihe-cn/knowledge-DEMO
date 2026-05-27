"""add assessment module: learner / template / assignment / response

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # learner
    op.create_table(
        "learner",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("dept", sa.String(64), nullable=False, server_default=""),
        sa.Column("external_ref", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_learner_name", "learner", ["name"])

    # assessment_template
    op.create_table(
        "assessment_template",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False, server_default="bank"),
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scope", sa.JSON, nullable=True),
        sa.Column("question_set", sa.JSON, nullable=True),
        sa.Column("pass_score", sa.Float, nullable=False, server_default="60"),
        sa.Column("time_limit_sec", sa.Integer, nullable=True),
        sa.Column("num_questions", sa.Integer, nullable=False, server_default="5"),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="admin"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_assessment_template_product", "assessment_template", ["product_id"])

    # assessment_assignment
    op.create_table(
        "assessment_assignment",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "template_id",
            sa.BigInteger,
            sa.ForeignKey("assessment_template.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "learner_id",
            sa.BigInteger,
            sa.ForeignKey("learner.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("due_at", sa.DateTime, nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("score", sa.Float, nullable=True),
        sa.Column("started_at", sa.DateTime, nullable=True),
        sa.Column("submitted_at", sa.DateTime, nullable=True),
        sa.Column("graded_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_assignment_template", "assessment_assignment", ["template_id"])
    op.create_index("ix_assignment_learner", "assessment_assignment", ["learner_id"])
    op.create_index("ix_assignment_status", "assessment_assignment", ["status"])
    op.create_index("ix_assignment_token", "assessment_assignment", ["token"])

    # assessment_response
    op.create_table(
        "assessment_response",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "assignment_id",
            sa.BigInteger,
            sa.ForeignKey("assessment_assignment.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("turn_idx", sa.Integer, nullable=False),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("answer_text", sa.Text, nullable=True),
        sa.Column("ai_score", sa.Float, nullable=True),
        sa.Column("ai_feedback", sa.JSON, nullable=True),
        sa.Column("human_score_override", sa.Float, nullable=True),
        sa.Column("human_comment", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("assignment_id", "turn_idx", name="uq_response_turn"),
    )
    op.create_index("ix_response_assignment", "assessment_response", ["assignment_id"])


def downgrade() -> None:
    op.drop_index("ix_response_assignment", table_name="assessment_response")
    op.drop_table("assessment_response")
    op.drop_index("ix_assignment_token", table_name="assessment_assignment")
    op.drop_index("ix_assignment_status", table_name="assessment_assignment")
    op.drop_index("ix_assignment_learner", table_name="assessment_assignment")
    op.drop_index("ix_assignment_template", table_name="assessment_assignment")
    op.drop_table("assessment_assignment")
    op.drop_index("ix_assessment_template_product", table_name="assessment_template")
    op.drop_table("assessment_template")
    op.drop_index("ix_learner_name", table_name="learner")
    op.drop_table("learner")
