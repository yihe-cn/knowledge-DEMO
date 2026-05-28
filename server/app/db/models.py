from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# SQLite 的 autoincrement 只对 INTEGER PRIMARY KEY（rowid 别名）生效，BIGINT 不会被
# 当成 rowid 别名，INSERT 不带 id 就会撞 NOT NULL。生产用 MySQL 仍然 BIGINT，所以
# 用 with_variant 让 SQLite 退回 INTEGER，对 ID 范围足够（rowid 本身就是 64-bit）。
BigIntPK = BigInteger().with_variant(Integer(), "sqlite")


class DocStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class KpStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    archived = "archived"


class LinkSource(str, enum.Enum):
    llm = "llm"
    manual = "manual"


class ProductStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class ProductLinkSource(str, enum.Enum):
    auto = "auto"
    manual = "manual"


class PracticeRoleSource(str, enum.Enum):
    ai = "ai"
    manual = "manual"


class AssessmentMode(str, enum.Enum):
    # 固定题库：admin 预先出 N 题，学员逐题作答
    bank = "bank"
    # AI 主考：AI 根据 scope 连续提问 N 轮
    ai_oral = "ai_oral"


class AssignmentStatus(str, enum.Enum):
    pending = "pending"          # 已分配未开始
    in_progress = "in_progress"  # 学员已打开链接
    submitted = "submitted"      # 学员提交，等待评分（demo 通常自动评分→graded）
    graded = "graded"            # 最终分已出
    stopped = "stopped"          # 管理员停止，链接不可继续作答


class CourseAssignmentStatus(str, enum.Enum):
    active = "active"
    revoked = "revoked"


class KpTier(str, enum.Enum):
    core = "core"
    detail = "detail"


class EnrichStatus(str, enum.Enum):
    pending = "pending"
    done = "done"
    failed = "failed"


class RetrievalIndexStatus(str, enum.Enum):
    """KP 检索索引（kp_embeddings collection）的同步状态。
    与 enrich_status 解耦：enrich 失败兜底也会建基础索引，索引可独立成功 / 失败。"""

    pending = "pending"
    done = "done"
    failed = "failed"


class ExamStatus(str, enum.Enum):
    pending = "pending"
    generating = "generating"
    ready = "ready"
    error = "error"


class LearnerKpStatus(str, enum.Enum):
    unseen = "unseen"
    viewed = "viewed"
    passed = "passed"
    failed = "failed"
    skipped = "skipped"


class Product(Base):
    """业务产品维度。对应学员端 productCatalog 里的一个产品（如极氪 007、宝怡乐 PAX）。"""

    __tablename__ = "product"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    industry: Mapped[str] = mapped_column(String(64), default="")
    student_role: Mapped[str] = mapped_column(String(64), default="")
    customer_label: Mapped[str] = mapped_column(String(64), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # 产品/行业特征简介：KB 未命中时喂给经验回答模型作为背景上下文。
    # 留空 = 该产品不启用经验回答（即便 allow_experience_answer=True）。
    features_brief: Mapped[str] = mapped_column(Text, default="", nullable=False)
    allow_experience_answer: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )
    # 单 KP 学习闭环的及格阈值（0-100）。学员逐 KP 答题时，AI 评分 >= 此值视为 passed。
    pass_score: Mapped[int] = mapped_column(Integer, default=70, server_default="70", nullable=False)
    # 产品封面图的相对路径，如 /uploads/products/xxx.jpg；为 None 时前端降级为 CSS 封面。
    cover_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[ProductStatus] = mapped_column(
        Enum(ProductStatus, native_enum=False, length=16),
        default=ProductStatus.active,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class KpProductLink(Base):
    """KP ↔ Product 多对多。一个 KP 可挂多个产品（通用话术 KP 跨产品复用）。"""

    __tablename__ = "kp_product_link"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    kp_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("kp_registry.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[ProductLinkSource] = mapped_column(
        Enum(ProductLinkSource, native_enum=False, length=16),
        default=ProductLinkSource.auto,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("kp_id", "product_id", name="uq_kp_product"),)


class KbDocument(Base):
    __tablename__ = "kb_document"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime: Mapped[str] = mapped_column(String(128), default="")
    product_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[DocStatus] = mapped_column(
        Enum(DocStatus, native_enum=False, length=32), default=DocStatus.pending, nullable=False
    )
    error: Mapped[str] = mapped_column(Text, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    chunks: Mapped[list["KbChunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class KbChunk(Base):
    __tablename__ = "kb_chunk"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    doc_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kb_document.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    # 溯源元数据：pptx 的 slide_index、pdf 的 page，统一塞 JSON
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    document: Mapped[KbDocument] = relationship(back_populates="chunks")
    kp_links: Mapped[list["KpChunkLink"]] = relationship(back_populates="chunk", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("doc_id", "chunk_index", name="uq_chunk_doc_idx"),
    )


class KpRegistry(Base):
    __tablename__ = "kp_registry"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    definition: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[KpStatus] = mapped_column(
        Enum(KpStatus, native_enum=False, length=32), default=KpStatus.draft, nullable=False
    )
    created_by: Mapped[str] = mapped_column(String(64), default="llm")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    chunk_links: Mapped[list["KpChunkLink"]] = relationship(back_populates="kp", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_kp_status", "status"),
    )


class KpCardContent(Base):
    """KP 的富展示字段 sidecar 表。与 kp_registry 一对一。
    Pass-2 enrich 写入 / admin 编辑。学员端卡片渲染所需。
    """

    __tablename__ = "kp_card_content"

    kp_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("kp_registry.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tier: Mapped[KpTier] = mapped_column(
        Enum(KpTier, native_enum=False, length=16),
        default=KpTier.detail,
        nullable=False,
    )
    spec: Mapped[str] = mapped_column(Text, default="", nullable=False)
    customer_voice: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # [{"type": "官方|实测|内部", "label": "..."}]
    sources: Mapped[list] = mapped_column(JSON, default=list)
    # [str]
    applies_to: Mapped[list] = mapped_column(JSON, default=list)
    # [str]
    not_applicable: Mapped[list] = mapped_column(JSON, default=list)
    # [{"q": "...", "approach": "..."}]
    rebuttals: Mapped[list] = mapped_column(JSON, default=list)
    sales: Mapped[str] = mapped_column(Text, default="", nullable=False)

    enrich_status: Mapped[EnrichStatus] = mapped_column(
        Enum(EnrichStatus, native_enum=False, length=16),
        default=EnrichStatus.pending,
        nullable=False,
    )
    enrich_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 单 KP 学习闭环：闭卷考题（admin 后台预生成）。学员侧只读 exam_question；rubric 留服务端评分用。
    # TEXT 列在 MySQL 不支持 DEFAULT，因此存 NULL，所有读路径用 `or ""` 兜底。
    exam_question: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    # [str] 评分要点，结构对齐 AssessmentTemplate.question_set[].rubric
    exam_rubric: Mapped[list] = mapped_column(JSON, default=list)
    # 生成时返回的 ref_chunk_ids / ref_kp_ids；评分时回放给 LLM，保留 assessment_graph 的素材溯源
    exam_ref_chunk_ids: Mapped[list] = mapped_column(JSON, default=list)
    exam_ref_kp_ids: Mapped[list] = mapped_column(JSON, default=list)
    exam_status: Mapped[ExamStatus] = mapped_column(
        Enum(ExamStatus, native_enum=False, length=16),
        default=ExamStatus.pending,
        server_default="pending",
        nullable=False,
    )
    exam_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    exam_error: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)

    # 召回富化字段：用于提升 query→KP 的语义匹配。enricher 生成、reindex_kp_sync 拼成
    # 一段长文本送 Milvus kp_embeddings collection。MySQL TEXT/JSON 不支持 DEFAULT，
    # 读路径用 `or []` / `or ""` 兜底。
    trigger_questions: Mapped[list] = mapped_column(JSON, default=list)
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    scenario: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    retrieval_indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retrieval_index_status: Mapped[RetrievalIndexStatus] = mapped_column(
        Enum(RetrievalIndexStatus, native_enum=False, length=16),
        default=RetrievalIndexStatus.pending,
        server_default="pending",
        nullable=False,
    )
    retrieval_index_error: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    # 索引文本内容指纹（sha256 hex），用于并发竞态防覆盖：旧任务的 hash 不匹配当前内容时放弃 upsert
    retrieval_content_hash: Mapped[str | None] = mapped_column(String(64), default=None, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class KpChunkLink(Base):
    __tablename__ = "kp_chunk_link"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    kp_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kp_registry.id", ondelete="CASCADE"), index=True)
    chunk_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kb_chunk.id", ondelete="CASCADE"), index=True)
    relevance: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[LinkSource] = mapped_column(
        Enum(LinkSource, native_enum=False, length=16), default=LinkSource.llm
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    kp: Mapped[KpRegistry] = relationship(back_populates="chunk_links")
    chunk: Mapped[KbChunk] = relationship(back_populates="kp_links")

    __table_args__ = (
        UniqueConstraint("kp_id", "chunk_id", name="uq_kp_chunk"),
    )


class KpExtractionJob(Base):
    """KP 抽取 Spike 留痕：每个 doc 一行（或多行重跑）。"""

    __tablename__ = "kp_extraction_job"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    doc_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kb_document.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    new_kp_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_output: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PracticeRole(Base):
    """产品下的演练角色（客户人设）。一个产品有 1 个 default + 多个备选。"""

    __tablename__ = "practice_role"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), index=True, nullable=False
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    name: Mapped[str] = mapped_column(String(64), default="")
    age: Mapped[int] = mapped_column(Integer, default=35)
    job: Mapped[str] = mapped_column(String(128), default="")
    city: Mapped[str] = mapped_column(String(64), default="")
    family: Mapped[str] = mapped_column(String(255), default="")
    budget: Mapped[str] = mapped_column(String(128), default="")

    tagline: Mapped[str] = mapped_column(String(255), default="")
    vibe: Mapped[str] = mapped_column(String(64), default="")
    emoji: Mapped[str] = mapped_column(String(16), default="🙂")
    avatar: Mapped[str] = mapped_column(String(16), default="客")
    avatar_color: Mapped[str] = mapped_column(String(32), default="dark")

    motivation: Mapped[str] = mapped_column(Text, default="")
    opener: Mapped[str] = mapped_column(Text, default="")
    context: Mapped[str] = mapped_column(Text, default="")
    prompt_seed: Mapped[str] = mapped_column(Text, default="")

    personality: Mapped[list] = mapped_column(JSON, default=list)
    concerns: Mapped[list] = mapped_column(JSON, default=list)
    mood: Mapped[dict] = mapped_column(JSON, default=dict)

    source: Mapped[PracticeRoleSource] = mapped_column(
        Enum(PracticeRoleSource, native_enum=False, length=16),
        default=PracticeRoleSource.ai,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class CourseAssignment(Base):
    """课程分发：把 Product 课程开给某个 Learner。撤销走软状态，便于后续审计。"""

    __tablename__ = "course_assignment"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), index=True, nullable=False
    )
    learner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("learner.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[CourseAssignmentStatus] = mapped_column(
        Enum(CourseAssignmentStatus, native_enum=False, length=16),
        default=CourseAssignmentStatus.active,
        nullable=False,
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("product_id", "learner_id", name="uq_course_assignment_product_learner"),
        Index("ix_course_assignment_status", "status"),
    )


# ── 考核模块 ───────────────────────────────────────────
class Learner(Base):
    """轻量学员档案：demo 阶段不做注册/登录，仅由 admin 创建。"""

    __tablename__ = "learner"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    dept: Mapped[str] = mapped_column(String(64), default="")
    # 外部系统标识（工号/邮箱/手机号），demo 选填，方便后续对接 SSO
    external_ref: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (Index("ix_learner_name", "name"),)


class AssessmentTemplate(Base):
    """考核模板：admin 定义一份考核包含哪些题（bank）或考哪些范围（ai_oral）。"""

    __tablename__ = "assessment_template"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    mode: Mapped[AssessmentMode] = mapped_column(
        Enum(AssessmentMode, native_enum=False, length=16),
        default=AssessmentMode.bank,
        nullable=False,
    )
    product_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 考核范围：{"kp_ids": [..], "product_ids": [..]}；bank 用于辅助出题，ai_oral 用于约束 AI 提问
    scope: Mapped[dict] = mapped_column(JSON, default=dict)
    # bank 模式题库：[{idx, text, rubric: [要点1, 要点2], ref_chunk_ids: [..], ref_kp_ids: [..]}]
    # ai_oral 模式留空
    question_set: Mapped[list] = mapped_column(JSON, default=list)
    pass_score: Mapped[float] = mapped_column(Float, default=60.0)
    time_limit_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ai_oral 模式的目标轮数；bank 模式可用作展示
    num_questions: Mapped[int] = mapped_column(Integer, default=5)
    created_by: Mapped[str] = mapped_column(String(64), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class AssessmentAssignment(Base):
    """考核任务：admin 把某 template 分配给某 learner。一次性 token 链接作为学员入口。"""

    __tablename__ = "assessment_assignment"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("assessment_template.id", ondelete="CASCADE"), index=True
    )
    learner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("learner.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(AssignmentStatus, native_enum=False, length=16),
        default=AssignmentStatus.pending,
        nullable=False,
    )
    # 最终汇总分数（0-100），未评分时为 None
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_assignment_status", "status"),
        Index("ix_assignment_token", "token"),
    )


class AssessmentResponse(Base):
    """学员单题作答 + AI 评分结果。Bank 模式每题一行；oral 模式每轮一行。"""

    __tablename__ = "assessment_response"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("assessment_assignment.id", ondelete="CASCADE"), index=True
    )
    turn_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, default="")
    ai_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # {"rubric_breakdown": [{point, status: hit|miss|partial, note}], "citations": [chunk_id],
    #  "kp_tags": [kp_id], "missing_points": [..]}
    ai_feedback: Mapped[dict] = mapped_column(JSON, default=dict)
    human_score_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    human_comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("assignment_id", "turn_idx", name="uq_response_turn"),
    )


# ── 学习闭环（swipe 学习 + 逐 KP 考核） ──────────────────
class ProductKp(Base):
    """课程编排：某 product 的学习卡片序列，有序 + 软删除。
    与 KpProductLink 分离：KpProductLink 是宽泛的 KP↔Product 关联（含自动发现），
    ProductKp 是 admin 显式挑选并排过序的"课程目录"。
    """

    __tablename__ = "product_kp"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kp_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("kp_registry.id", ondelete="CASCADE"), index=True, nullable=False
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # 软删除：保留学员历史进度可追溯
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("product_id", "kp_id", name="uq_product_kp"),
    )


class LearnerKpProgress(Base):
    """学员单 KP 学习进度。一个 (learner, product, kp) 三元组一行。"""

    __tablename__ = "learner_kp_progress"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    learner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("learner.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), nullable=False
    )
    kp_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("kp_registry.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[LearnerKpStatus] = mapped_column(
        Enum(LearnerKpStatus, native_enum=False, length=16),
        default=LearnerKpStatus.unseen,
        server_default="unseen",
        nullable=False,
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # TEXT 列在 MySQL 不支持 DEFAULT，存 NULL，读路径用 `or ""` 兜底
    last_answer: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    # {"score": .., "rubric_breakdown": [...], "missing_points": [..], "comment": ".."}
    last_feedback: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("learner_id", "product_id", "kp_id", name="uq_learner_progress"),
    )
