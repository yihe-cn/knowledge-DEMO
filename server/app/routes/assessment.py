"""考核模块学员端 API。token 鉴权（URL ?token=... 或 X-Assessment-Token 头）。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    AssessmentAssignment,
    AssessmentMode,
    AssessmentResponse,
    AssessmentTemplate,
    AssignmentStatus,
    Learner,
    get_session,
)
from ..graphs.assessment_graph import (
    oral_final_evaluate,
    oral_next_question,
    score_bank_answer,
)
from ..schemas import LearnerAnswerRequest, LearnerOralAnswerRequest
from ..security import resolve_assignment_token

router = APIRouter()


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _template_to_public(t: AssessmentTemplate) -> dict[str, Any]:
    """学员可见的 template：脱敏去掉 rubric / ref_chunk_ids。"""
    safe_qs: list[dict[str, Any]] = []
    for q in t.question_set or []:
        safe_qs.append(
            {
                "idx": q.get("idx"),
                "text": q.get("text"),
            }
        )
    return {
        "id": t.id,
        "title": t.title,
        "mode": t.mode.value if hasattr(t.mode, "value") else str(t.mode),
        "pass_score": float(t.pass_score or 0.0),
        "time_limit_sec": t.time_limit_sec,
        "num_questions": t.num_questions or 0,
        "questions": safe_qs,  # 仅 bank 模式有内容
    }


def _assignment_to_public(a: AssessmentAssignment, learner_name: str = "") -> dict[str, Any]:
    return {
        "id": a.id,
        "template_id": a.template_id,
        "learner_id": a.learner_id,
        "learner_name": learner_name,
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "due_at": _iso(a.due_at),
        "score": float(a.score) if a.score is not None else None,
        "started_at": _iso(a.started_at),
        "submitted_at": _iso(a.submitted_at),
        "graded_at": _iso(a.graded_at),
    }


def _response_to_dict(r: AssessmentResponse) -> dict[str, Any]:
    return {
        "id": r.id,
        "turn_idx": r.turn_idx,
        "question_text": r.question_text,
        "answer_text": r.answer_text or "",
        "ai_score": float(r.ai_score) if r.ai_score is not None else None,
        "ai_feedback": r.ai_feedback or {},
        "human_score_override": None,  # 学员端不显示
        "human_comment": "",
        "created_at": _iso(r.created_at) or "",
    }


def _is_locked(a: AssessmentAssignment) -> bool:
    return a.status in (AssignmentStatus.submitted, AssignmentStatus.graded)


def _ensure_can_continue(a: AssessmentAssignment) -> None:
    if a.status == AssignmentStatus.stopped:
        raise HTTPException(410, "考核已被管理员停止")
    if _is_locked(a):
        raise HTTPException(409, "考核已提交，无法继续作答")


# ──────────────────────────────────────────────────────
# 学员主流程入口：按 account_ref 拉自己的考核任务（含 token）
# Demo 阶段把 account.id 当作弱身份；生产换 SSO。
# ──────────────────────────────────────────────────────
@router.get("/assessment/by-account/{account_ref}")
async def list_by_account(
    account_ref: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    learner = (
        await session.execute(select(Learner).where(Learner.external_ref == account_ref))
    ).scalar_one_or_none()
    if not learner:
        return {"items": []}
    rows = (
        await session.execute(
            select(AssessmentAssignment, AssessmentTemplate)
            .join(AssessmentTemplate, AssessmentTemplate.id == AssessmentAssignment.template_id)
            .where(AssessmentAssignment.learner_id == learner.id)
            .order_by(desc(AssessmentAssignment.id))
        )
    ).all()
    items: list[dict[str, Any]] = []
    for a, t in rows:
        items.append(
            {
                "assignment_id": a.id,
                "token": a.token,
                "status": a.status.value if hasattr(a.status, "value") else str(a.status),
                "score": float(a.score) if a.score is not None else None,
                "due_at": _iso(a.due_at),
                "started_at": _iso(a.started_at),
                "submitted_at": _iso(a.submitted_at),
                "graded_at": _iso(a.graded_at),
                "template": {
                    "id": t.id,
                    "title": t.title,
                    "mode": t.mode.value if hasattr(t.mode, "value") else str(t.mode),
                    "product_id": t.product_id,
                    "num_questions": t.num_questions or 0,
                    "pass_score": float(t.pass_score or 0.0),
                },
            }
        )
    return {"items": items}


@router.get("/assessment/session")
async def get_session_info(
    assignment: AssessmentAssignment = Depends(resolve_assignment_token),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    template = await session.get(AssessmentTemplate, assignment.template_id)
    if not template:
        raise HTTPException(404, "template missing")
    learner = await session.get(Learner, assignment.learner_id)

    # 首次打开 → in_progress + started_at
    if assignment.status == AssignmentStatus.pending:
        assignment.status = AssignmentStatus.in_progress
        assignment.started_at = datetime.utcnow()
        await session.commit()
        await session.refresh(assignment)

    answered = (
        await session.execute(
            select(AssessmentResponse)
            .where(AssessmentResponse.assignment_id == assignment.id)
            .order_by(AssessmentResponse.turn_idx)
        )
    ).scalars().all()

    return {
        "assignment": _assignment_to_public(assignment, learner_name=learner.name if learner else ""),
        "template": _template_to_public(template),
        "answered": [_response_to_dict(r) for r in answered],
    }


# ──────────────────────────────────────────────────────
# Bank 模式：单题作答
# ──────────────────────────────────────────────────────
@router.post("/assessment/answer")
async def submit_bank_answer(
    body: LearnerAnswerRequest,
    assignment: AssessmentAssignment = Depends(resolve_assignment_token),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _ensure_can_continue(assignment)
    template = await session.get(AssessmentTemplate, assignment.template_id)
    if not template or template.mode != AssessmentMode.bank:
        raise HTTPException(400, "当前考核不是题库模式")

    qs = template.question_set or []
    q = next((x for x in qs if int(x.get("idx", -1)) == body.turn_idx), None)
    if not q:
        raise HTTPException(400, "题号不存在")

    # 如已答过 → 覆盖（demo 允许）
    existing = (
        await session.execute(
            select(AssessmentResponse).where(
                AssessmentResponse.assignment_id == assignment.id,
                AssessmentResponse.turn_idx == body.turn_idx,
            )
        )
    ).scalar_one_or_none()

    feedback = await score_bank_answer(
        question_text=q.get("text") or "",
        rubric=q.get("rubric") or [],
        ref_chunk_ids=q.get("ref_chunk_ids") or [],
        ref_kp_ids=q.get("ref_kp_ids") or [],
        learner_answer=body.answer_text,
    )

    if existing:
        existing.answer_text = body.answer_text
        existing.ai_score = feedback["score"]
        existing.ai_feedback = {k: v for k, v in feedback.items() if k != "score"}
    else:
        session.add(
            AssessmentResponse(
                assignment_id=assignment.id,
                turn_idx=body.turn_idx,
                question_text=q.get("text") or "",
                answer_text=body.answer_text,
                ai_score=feedback["score"],
                ai_feedback={k: v for k, v in feedback.items() if k != "score"},
            )
        )
    await session.commit()
    return {"ai_score": feedback["score"], "ai_feedback": {k: v for k, v in feedback.items() if k != "score"}}


# ──────────────────────────────────────────────────────
# AI 主考：下一题（一次请求一题；保持简单不走 SSE）
# ──────────────────────────────────────────────────────
@router.get("/assessment/oral/next")
async def oral_next(
    assignment: AssessmentAssignment = Depends(resolve_assignment_token),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _ensure_can_continue(assignment)
    template = await session.get(AssessmentTemplate, assignment.template_id)
    if not template or template.mode != AssessmentMode.ai_oral:
        raise HTTPException(400, "当前考核不是 AI 主考模式")

    answered = (
        await session.execute(
            select(AssessmentResponse)
            .where(AssessmentResponse.assignment_id == assignment.id)
            .order_by(AssessmentResponse.turn_idx)
        )
    ).scalars().all()
    turn_idx = len(answered)
    total = int(template.num_questions or 0) or 5
    if turn_idx >= total:
        return {"done": True, "turn_idx": turn_idx, "total": total}

    scope = template.scope or {}
    scope_kp_ids = [int(x) for x in (scope.get("kp_ids") or []) if str(x).lstrip("-").isdigit()]
    asked: list[int] = []
    history: list[dict[str, Any]] = []
    for r in answered:
        fb = r.ai_feedback or {}
        for kid in (fb.get("kp_tags") or []):
            try:
                asked.append(int(kid))
            except (TypeError, ValueError):
                pass
        history.append({"q": r.question_text, "a": r.answer_text, "score": r.ai_score})

    nxt = await oral_next_question(
        scope_kp_ids=scope_kp_ids,
        asked_kp_ids=asked,
        history=history,
        turn_idx=turn_idx,
    )
    return {
        "done": False,
        "turn_idx": turn_idx,
        "total": total,
        "question_text": nxt["question_text"],
        "ref_kp_ids": nxt["ref_kp_ids"],
        "ref_chunk_ids": nxt["ref_chunk_ids"],
        "focus_dimension": nxt.get("focus_dimension") or "",
        "source_mode": nxt.get("source_mode") or "fallback",
        "is_fallback": bool(nxt.get("is_fallback")),
    }


@router.post("/assessment/oral/answer")
async def oral_answer(
    body: LearnerOralAnswerRequest,
    assignment: AssessmentAssignment = Depends(resolve_assignment_token),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _ensure_can_continue(assignment)
    template = await session.get(AssessmentTemplate, assignment.template_id)
    if not template or template.mode != AssessmentMode.ai_oral:
        raise HTTPException(400, "当前考核不是 AI 主考模式")

    # ai_oral 模式没有预存 rubric，让 LLM 基于参考 chunks 自己评
    feedback = await score_bank_answer(
        question_text=body.question_text,
        rubric=[],
        ref_chunk_ids=body.ref_chunk_ids or [],
        ref_kp_ids=body.ref_kp_ids or [],
        learner_answer=body.answer_text,
    )
    session.add(
        AssessmentResponse(
            assignment_id=assignment.id,
            turn_idx=body.turn_idx,
            question_text=body.question_text,
            answer_text=body.answer_text,
            ai_score=feedback["score"],
            ai_feedback={k: v for k, v in feedback.items() if k != "score"},
        )
    )
    await session.commit()
    return {"ai_score": feedback["score"], "ai_feedback": {k: v for k, v in feedback.items() if k != "score"}}


# ──────────────────────────────────────────────────────
# 收尾：算总分 + （oral 模式）综合评价
# ──────────────────────────────────────────────────────
@router.post("/assessment/submit")
async def submit_assignment(
    assignment: AssessmentAssignment = Depends(resolve_assignment_token),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if assignment.status == AssignmentStatus.stopped:
        raise HTTPException(410, "考核已被管理员停止")
    if _is_locked(assignment):
        # 重复提交直接回放最终结果
        pass
    template = await session.get(AssessmentTemplate, assignment.template_id)
    if not template:
        raise HTTPException(404, "template missing")

    resps = (
        await session.execute(
            select(AssessmentResponse)
            .where(AssessmentResponse.assignment_id == assignment.id)
            .order_by(AssessmentResponse.turn_idx)
        )
    ).scalars().all()

    scores = [float(r.ai_score) for r in resps if r.ai_score is not None]
    final_score = (sum(scores) / len(scores)) if scores else 0.0

    # 按 kp 拆分
    kp_acc: dict[int, list[float]] = {}
    for r in resps:
        fb = r.ai_feedback or {}
        if r.ai_score is None:
            continue
        for kid in (fb.get("kp_tags") or []):
            try:
                kpi = int(kid)
            except (TypeError, ValueError):
                continue
            kp_acc.setdefault(kpi, []).append(float(r.ai_score))
    by_kp = [
        {"kp_id": k, "count": len(v), "avg_score": sum(v) / len(v)}
        for k, v in sorted(kp_acc.items())
    ]

    summary: dict[str, Any] = {}
    if template.mode == AssessmentMode.ai_oral:
        summary = await oral_final_evaluate(
            [
                {
                    "q": r.question_text,
                    "a": r.answer_text,
                    "score": r.ai_score,
                    "kp_ids": (r.ai_feedback or {}).get("kp_tags") or [],
                }
                for r in resps
            ]
        )

    if not _is_locked(assignment):
        assignment.score = final_score
        assignment.status = AssignmentStatus.graded
        assignment.submitted_at = datetime.utcnow()
        assignment.graded_at = datetime.utcnow()
        await session.commit()
        await session.refresh(assignment)

    pass_score = float(template.pass_score or 60.0)
    return {
        "score": final_score,
        "pass_score": pass_score,
        "passed": final_score >= pass_score,
        "by_kp": by_kp,
        "summary": summary,
    }
