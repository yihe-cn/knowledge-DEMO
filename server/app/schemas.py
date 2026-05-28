from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


# ── AIQA ──────────────────────────────────────────────
class QARequest(BaseModel):
    product_id: str | None = None
    knowledge: list[dict[str, Any]] = Field(default_factory=list)  # 兼容字段，RAG 改造后不再依赖
    product_meta: dict[str, Any] = Field(default_factory=dict)
    messages: list[ChatMessage]


class Citation(BaseModel):
    index: int
    chunk_id: int
    doc_id: int
    doc_name: str = ""
    slide_indices: list[int] = Field(default_factory=list)
    snippet: str = ""


class TaggedKP(BaseModel):
    kp_id: int
    name: str
    confidence: float = 0.0


# ── Practice ──────────────────────────────────────────
class PracticeTurnRequest(BaseModel):
    customer: dict[str, Any]
    history: list[dict[str, Any]]  # [{role:'student'|'customer', text}]
    student_text: str
    mood: dict[str, float] = Field(default_factory=lambda: {"interest": 50, "trust": 50})
    difficulty: Literal["tough", "normal", "gentle"] = "normal"
    kp_list: list[dict[str, Any]] = Field(default_factory=list)  # [{id, summary}]


class PracticeEvaluateRequest(BaseModel):
    """练后评估报告请求：把整场 picks + 上下文交给后端 Graph。"""
    customer: dict[str, Any] = Field(default_factory=dict)
    picks: list[dict[str, Any]] = Field(default_factory=list)
    kp_list: list[dict[str, Any]] = Field(default_factory=list)
    final_mood: dict[str, float] = Field(default_factory=lambda: {"interest": 50, "trust": 50})
    viewed_kp: list[str] = Field(default_factory=list)
    product_code: str | None = None


class PracticeSuggestRequest(BaseModel):
    """点 ✦ 时拉一组回应思路（独立于 turn 接口）。"""
    customer: dict[str, Any]
    history: list[dict[str, Any]]  # 含客户最新一条
    mood: dict[str, float] = Field(default_factory=lambda: {"interest": 50, "trust": 50})
    difficulty: Literal["tough", "normal", "gentle"] = "normal"
    kp_list: list[dict[str, Any]] = Field(default_factory=list)
    product_code: str | None = None


# ── Quiz ──────────────────────────────────────────────
class QuizGenerateRequest(BaseModel):
    customer: dict[str, Any]
    knowledge: list[dict[str, Any]]
    count: int = 5


class QuizGradeRequest(BaseModel):
    question: dict[str, Any]
    kp: dict[str, Any]
    student_answer: str


# ── Admin: KB 文档管理 ─────────────────────────────────
class KbDocumentOut(BaseModel):
    id: int
    file_name: str
    mime: str
    status: str
    chunk_count: int
    error: str = ""
    created_at: str
    updated_at: str


class KbDocumentDetail(KbDocumentOut):
    source_path: str
    latest_job: dict[str, Any] | None = None


class KbChunkOut(BaseModel):
    id: int
    chunk_index: int
    text: str
    token_count: int
    meta: dict[str, Any] = Field(default_factory=dict)
    kp_ids: list[int] = Field(default_factory=list)


class KpExtractionJobOut(BaseModel):
    id: int
    doc_id: int
    status: str
    candidate_count: int
    new_kp_count: int
    error: str = ""
    created_at: str
    finished_at: str | None = None


# ── Admin: KP 治理增量 ─────────────────────────────────
class KpMergeRequest(BaseModel):
    source_kp_id: int


class KpLinkRequest(BaseModel):
    chunk_id: int
    relevance: float = 1.0


class KpBulkIdsRequest(BaseModel):
    """通用批量操作请求体（bulk-approve / bulk-archive / bulk-delete 复用）。"""
    kp_ids: list[int]


# 旧名保留向后兼容（与 KpBulkIdsRequest 同形）
KpBulkApproveRequest = KpBulkIdsRequest


# ── Dashboard ─────────────────────────────────────────
class DashboardOverview(BaseModel):
    kp_total: int
    kp_approved: int
    kp_draft: int
    kp_archived: int
    approved_ratio: float
    doc_total: int
    doc_ready: int
    doc_failed: int
    pending_review: int


class KpMapItem(BaseModel):
    category: str
    total: int
    approved: int
    draft: int


class AttentionItem(BaseModel):
    type: Literal["pending_kp", "failed_doc", "kp_no_chunk"]
    target_id: int
    title: str
    detail: str = ""


# ── Product ────────────────────────────────────────────
class ProductOut(BaseModel):
    id: int
    code: str
    name: str
    industry: str = ""
    student_role: str = ""
    customer_label: str = ""
    description: str = ""
    features_brief: str = ""
    allow_experience_answer: bool = True
    status: str = "active"
    kp_count: int = 0
    doc_count: int = 0


class ProductCreate(BaseModel):
    # code 用作 URL path（/api/courses/{code}）且作为前端 productId，
    # 限制为 slug：字母数字/下划线/中划线，避免 / # ? 空格 等 URL 元字符
    code: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str
    industry: str = ""
    student_role: str = ""
    customer_label: str = ""
    description: str = ""
    features_brief: str = ""
    allow_experience_answer: bool = True


class ProductPatch(BaseModel):
    code: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str | None = None
    industry: str | None = None
    student_role: str | None = None
    customer_label: str | None = None
    description: str | None = None
    features_brief: str | None = None
    allow_experience_answer: bool | None = None
    status: Literal["active", "archived"] | None = None
    pass_score: int | None = Field(default=None, ge=0, le=100)


class DocBackfillRequest(BaseModel):
    product_id: int


class KpProductBindRequest(BaseModel):
    product_ids: list[int]


class CourseAssignmentCreate(BaseModel):
    product_id: int
    learner_ids: list[int]


# ── Assessment 模块 ───────────────────────────────────
class AssessmentScope(BaseModel):
    kp_ids: list[int] = Field(default_factory=list)
    product_ids: list[int] = Field(default_factory=list)


class AssessmentQuestion(BaseModel):
    """bank 模式单题。idx 由后端按序生成。"""
    idx: int
    text: str
    rubric: list[str] = Field(default_factory=list)  # 要点列表
    ref_chunk_ids: list[int] = Field(default_factory=list)
    ref_kp_ids: list[int] = Field(default_factory=list)


class AssessmentTemplateCreate(BaseModel):
    title: str
    mode: Literal["bank", "ai_oral"] = "bank"
    product_id: int | None = None
    scope: AssessmentScope = Field(default_factory=AssessmentScope)
    question_set: list[AssessmentQuestion] = Field(default_factory=list)
    pass_score: float = 60.0
    time_limit_sec: int | None = None
    num_questions: int = 5


class AssessmentTemplatePatch(BaseModel):
    title: str | None = None
    mode: Literal["bank", "ai_oral"] | None = None
    product_id: int | None = None
    scope: AssessmentScope | None = None
    question_set: list[AssessmentQuestion] | None = None
    pass_score: float | None = None
    time_limit_sec: int | None = None
    num_questions: int | None = None


class AssessmentTemplateOut(BaseModel):
    id: int
    title: str
    mode: str
    product_id: int | None = None
    scope: dict[str, Any] = Field(default_factory=dict)
    question_set: list[dict[str, Any]] = Field(default_factory=list)
    pass_score: float = 60.0
    time_limit_sec: int | None = None
    num_questions: int = 5
    created_by: str = "admin"
    created_at: str
    updated_at: str


class GenerateQuestionsRequest(BaseModel):
    num: int = 5
    difficulty: Literal["easy", "normal", "hard"] = "normal"
    scope_kp_ids: list[int] | None = None


class LearnerCreate(BaseModel):
    name: str
    dept: str = ""
    external_ref: str = ""


class LearnerOut(BaseModel):
    id: int
    name: str
    dept: str = ""
    external_ref: str = ""
    created_at: str


class AssignmentCreateRequest(BaseModel):
    template_id: int
    learner_ids: list[int]
    due_at: str | None = None  # ISO datetime


class AssignmentShareOut(BaseModel):
    id: int
    template_id: int
    learner_id: int
    learner_name: str = ""
    token: str
    share_url: str = ""
    status: str = "pending"
    due_at: str | None = None
    score: float | None = None
    started_at: str | None = None
    submitted_at: str | None = None
    graded_at: str | None = None
    created_at: str


class AssignmentResponseOut(BaseModel):
    id: int
    turn_idx: int
    question_text: str
    answer_text: str = ""
    ai_score: float | None = None
    ai_feedback: dict[str, Any] = Field(default_factory=dict)
    human_score_override: float | None = None
    human_comment: str = ""
    created_at: str


class AssignmentDetailOut(AssignmentShareOut):
    template: AssessmentTemplateOut
    responses: list[AssignmentResponseOut] = Field(default_factory=list)


class AssignmentOverrideRequest(BaseModel):
    response_id: int
    human_score: float
    comment: str = ""


# Learner 端（token 鉴权）
class LearnerSessionOut(BaseModel):
    assignment: AssignmentShareOut
    template: AssessmentTemplateOut
    # 题面（脱敏：不含 rubric/ref_chunk_ids）；ai_oral 模式返回空数组
    questions: list[dict[str, Any]] = Field(default_factory=list)
    # 已答过的轮次（断点续答用）
    answered: list[AssignmentResponseOut] = Field(default_factory=list)


class LearnerAnswerRequest(BaseModel):
    turn_idx: int
    answer_text: str


class LearnerAnswerOut(BaseModel):
    ai_score: float
    ai_feedback: dict[str, Any] = Field(default_factory=dict)


class LearnerOralAnswerRequest(BaseModel):
    turn_idx: int
    question_text: str
    answer_text: str
    ref_kp_ids: list[int] = Field(default_factory=list)
    ref_chunk_ids: list[int] = Field(default_factory=list)


class LearnerSubmitOut(BaseModel):
    score: float
    pass_score: float
    passed: bool
    by_kp: list[dict[str, Any]] = Field(default_factory=list)


# ── KP 卡片富字段 ─────────────────────────────────────
class KpCardSource(BaseModel):
    type: Literal["官方", "实测", "内部"] = "内部"
    label: str = ""


class KpRebuttal(BaseModel):
    q: str = ""
    approach: str = ""


class KpCardOut(BaseModel):
    tier: Literal["core", "detail"] = "detail"
    spec: str = ""
    customer_voice: str = ""
    sources: list[dict[str, Any]] = Field(default_factory=list)
    applies_to: list[str] = Field(default_factory=list)
    not_applicable: list[str] = Field(default_factory=list)
    rebuttals: list[dict[str, Any]] = Field(default_factory=list)
    sales: str = ""
    trigger_questions: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    scenario: str = ""
    retrieval_indexed_at: str | None = None
    retrieval_index_status: Literal["pending", "done", "failed"] = "pending"
    retrieval_index_error: str = ""
    enrich_status: Literal["pending", "done", "failed"] = "pending"
    enrich_error: str = ""
    enriched_at: str | None = None


class KpCardUpdateIn(BaseModel):
    tier: Literal["core", "detail"] | None = None
    spec: str | None = None
    customer_voice: str | None = None
    sources: list[KpCardSource] | None = None
    applies_to: list[str] | None = None
    not_applicable: list[str] | None = None
    rebuttals: list[KpRebuttal] | None = None
    sales: str | None = None
    trigger_questions: list[str] | None = None
    aliases: list[str] | None = None
    scenario: str | None = None


class KpReindexBatchRequest(BaseModel):
    """批量重建 KP 召回索引。kp_ids 留空时默认全部 approved KP。
    reenrich=True 时每个 KP 先重跑 enrich（调 LLM）再 reindex。"""

    kp_ids: list[int] | None = None
    reenrich: bool = False


# ── 学习闭环（swipe + 逐 KP 考核） ────────────────────
class KpExamUpdateIn(BaseModel):
    """Admin 手动编辑 KP 考题。"""

    exam_question: str | None = None
    exam_rubric: list[str] | None = None


class KpExamOut(BaseModel):
    exam_question: str = ""
    exam_rubric: list[str] = Field(default_factory=list)
    exam_status: Literal["pending", "generating", "ready", "error"] = "pending"
    exam_generated_at: str | None = None
    exam_error: str = ""


class ProductKpBindRequest(BaseModel):
    """全量替换 product 的课程编排 KP 列表。"""

    kp_ids: list[int]


class LearningAnswerIn(BaseModel):
    product_id: int
    answer: str = Field(..., min_length=1, max_length=2000)


class LearningSkipIn(BaseModel):
    product_id: int
