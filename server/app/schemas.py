from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


# ── AIQA ──────────────────────────────────────────────
class QARequest(BaseModel):
    product_id: str | None = None
    knowledge: list[dict[str, Any]] = Field(default_factory=list)  # 压缩后的模块/KP
    product_meta: dict[str, Any] = Field(default_factory=dict)
    messages: list[ChatMessage]


# ── Practice ──────────────────────────────────────────
class PracticeTurnRequest(BaseModel):
    customer: dict[str, Any]
    history: list[dict[str, Any]]  # [{role:'student'|'customer', text}]
    student_text: str
    mood: dict[str, float] = Field(default_factory=lambda: {"interest": 50, "trust": 50})
    difficulty: Literal["tough", "normal", "gentle"] = "normal"
    kp_list: list[dict[str, Any]] = Field(default_factory=list)  # [{id, summary}]


# ── Quiz ──────────────────────────────────────────────
class QuizGenerateRequest(BaseModel):
    customer: dict[str, Any]
    knowledge: list[dict[str, Any]]
    count: int = 5


class QuizGradeRequest(BaseModel):
    question: dict[str, Any]
    kp: dict[str, Any]
    student_answer: str
