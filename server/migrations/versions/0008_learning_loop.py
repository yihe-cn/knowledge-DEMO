"""学习闭环：product_kp 课程编排 + 学员 KP 进度 + KP 卡片侧的考题字段

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-27

设计取舍：
  - 新建 product_kp 表用于「课程编排」（有序 + 软删除），与已有的 kp_product_link
    （宽泛的 KP↔Product 关联，支持自动发现）分离，避免把"挂载到课程"和"被识别为
    相关"两件事混在一张表里。学员侧学习卡片只读 product_kp。
  - learner_kp_progress 记录单 KP 学习状态，唯一约束 (learner_id, product_id, kp_id)。
  - kp_card_content 加 exam_* 5 个字段（题干 / 评分要点 / 状态 / 生成时间 / 错误信息），
    沿用现有 sidecar 结构，不再新建表。
  - product 加 pass_score，按课程粒度决定及格阈值。
"""
from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. kp_card_content 加考题字段
    # MySQL 不允许 TEXT/JSON 列有 DEFAULT，所以 TEXT 列改 nullable=True，代码层 `or ""` 兜底
    with op.batch_alter_table("kp_card_content") as batch:
        batch.add_column(sa.Column("exam_question", sa.Text, nullable=True))
        batch.add_column(sa.Column("exam_rubric", sa.JSON, nullable=True))
        # 生成考题时引用的 chunk_id / kp_id 列表，评分时回放给 LLM 作参考材料
        # 保留 assessment_graph 的"基于素材打分"路径，避免学员侧评分丢溯源
        batch.add_column(sa.Column("exam_ref_chunk_ids", sa.JSON, nullable=True))
        batch.add_column(sa.Column("exam_ref_kp_ids", sa.JSON, nullable=True))
        batch.add_column(
            sa.Column("exam_status", sa.String(16), nullable=False, server_default="pending")
        )
        batch.add_column(sa.Column("exam_generated_at", sa.DateTime, nullable=True))
        batch.add_column(sa.Column("exam_error", sa.Text, nullable=True))

    # 2. product 加 pass_score（按课程粒度的及格阈值，0-100）
    with op.batch_alter_table("product") as batch:
        batch.add_column(
            sa.Column("pass_score", sa.Integer, nullable=False, server_default="70")
        )

    # 3. 课程编排表：每个 product 下挂哪些 KP，有序
    op.create_table(
        "product_kp",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "kp_id",
            sa.BigInteger,
            sa.ForeignKey("kp_registry.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("removed_at", sa.DateTime, nullable=True),
        sa.UniqueConstraint("product_id", "kp_id", name="uq_product_kp"),
    )
    op.create_index("ix_product_kp_product", "product_kp", ["product_id"])
    op.create_index("ix_product_kp_kp", "product_kp", ["kp_id"])

    # 4. 学员 KP 进度
    op.create_table(
        "learner_kp_progress",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "learner_id",
            sa.BigInteger,
            sa.ForeignKey("learner.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.BigInteger,
            sa.ForeignKey("product.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "kp_id",
            sa.BigInteger,
            sa.ForeignKey("kp_registry.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # unseen | viewed | passed | failed | skipped
        sa.Column("status", sa.String(16), nullable=False, server_default="unseen"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_score", sa.Float, nullable=True),
        # MySQL 不支持 TEXT 列 DEFAULT，存 NULL，代码层 `or ""` 兜底
        sa.Column("last_answer", sa.Text, nullable=True),
        sa.Column("last_feedback", sa.JSON, nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "learner_id", "product_id", "kp_id", name="uq_learner_progress"
        ),
    )
    op.create_index("ix_learner_progress_learner", "learner_kp_progress", ["learner_id"])
    op.create_index("ix_learner_progress_kp", "learner_kp_progress", ["kp_id"])

    # 5. Backfill：把已有 KpProductLink 灌进 ProductKp，避免老库升级后学习屏空白。
    # order_index 按 (product_id, kp_id) 升序编号；只搬 approved KP。
    # MySQL 不支持窗口函数 in 5.7，用 user-variable 实现 ROW_NUMBER OVER PARTITION BY。
    op.execute("SET @row := 0")
    op.execute("SET @prev := NULL")
    op.execute("""
        INSERT INTO product_kp (product_id, kp_id, order_index, created_at)
        SELECT
            t.product_id,
            t.kp_id,
            t.rn AS order_index,
            NOW()
        FROM (
            SELECT
                l.product_id,
                l.kp_id,
                @row := IF(@prev = l.product_id, @row + 1, 0) AS rn,
                @prev := l.product_id
            FROM kp_product_link l
            JOIN kp_registry k ON k.id = l.kp_id
            WHERE k.status = 'approved'
            ORDER BY l.product_id, l.kp_id
        ) t
    """)


def downgrade() -> None:
    op.drop_index("ix_learner_progress_kp", table_name="learner_kp_progress")
    op.drop_index("ix_learner_progress_learner", table_name="learner_kp_progress")
    op.drop_table("learner_kp_progress")

    op.drop_index("ix_product_kp_kp", table_name="product_kp")
    op.drop_index("ix_product_kp_product", table_name="product_kp")
    op.drop_table("product_kp")

    with op.batch_alter_table("product") as batch:
        batch.drop_column("pass_score")

    with op.batch_alter_table("kp_card_content") as batch:
        batch.drop_column("exam_error")
        batch.drop_column("exam_generated_at")
        batch.drop_column("exam_status")
        batch.drop_column("exam_ref_kp_ids")
        batch.drop_column("exam_ref_chunk_ids")
        batch.drop_column("exam_rubric")
        batch.drop_column("exam_question")
