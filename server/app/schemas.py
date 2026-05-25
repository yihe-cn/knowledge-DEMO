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


class KpBulkApproveRequest(BaseModel):
    kp_ids: list[int]


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
    name: str | None = None
    industry: str | None = None
    student_role: str | None = None
    customer_label: str | None = None
    description: str | None = None
    features_brief: str | None = None
    allow_experience_answer: bool | None = None
    status: Literal["active", "archived"] | None = None


class DocBackfillRequest(BaseModel):
    product_id: int


class KpProductBindRequest(BaseModel):
    product_ids: list[int]
