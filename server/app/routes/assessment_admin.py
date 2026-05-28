"""考核模块管理端 API。统一挂在 /api/admin/assessments 与 /api/admin/learners 前缀下。"""
from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import (
    AssessmentAssignment,
    AssessmentMode,
    AssessmentResponse,
    AssessmentTemplate,
    AssignmentStatus,
    Learner,
    get_session,
)
from ..graphs.assessment_graph import generate_bank_questions
from ..schemas import (
    AssessmentTemplateCreate,
    AssessmentTemplatePatch,
    AssignmentCreateRequest,
    AssignmentOverrideRequest,
    GenerateQuestionsRequest,
    LearnerCreate,
)

router = APIRouter()


# ──────────────────────────────────────────────────────
# 序列化
# ──────────────────────────────────────────────────────
def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _template_to_dict(t: AssessmentTemplate) -> dict[str, Any]:
    return {
        "id": t.id,
        "title": t.title,
        "mode": t.mode.value if hasattr(t.mode, "value") else str(t.mode),
        "product_id": t.product_id,
        "scope": t.scope or {},
        "question_set": t.question_set or [],
        "pass_score": float(t.pass_score or 0.0),
        "time_limit_sec": t.time_limit_sec,
        "num_questions": t.num_questions or 0,
        "created_by": t.created_by or "",
        "created_at": _iso(t.created_at) or "",
        "updated_at": _iso(t.updated_at) or "",
    }


def _build_share_url(token: str) -> str:
    base = settings.assessment_share_base_url.rstrip("/") if settings.assessment_share_base_url else ""
    if base:
        return f"{base}/?token={token}"
    # 留给 admin 前端自行拼；这里返回 query 片段
    return f"/?token={token}"


def _assignment_to_dict(a: AssessmentAssignment, learner_name: str = "") -> dict[str, Any]:
    return {
        "id": a.id,
        "template_id": a.template_id,
        "learner_id": a.learner_id,
        "learner_name": learner_name,
        "token": a.token,
        "share_url": _build_share_url(a.token),
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "due_at": _iso(a.due_at),
        "score": float(a.score) if a.score is not None else None,
        "started_at": _iso(a.started_at),
        "submitted_at": _iso(a.submitted_at),
        "graded_at": _iso(a.graded_at),
        "created_at": _iso(a.created_at) or "",
    }


def _response_to_dict(r: AssessmentResponse) -> dict[str, Any]:
    return {
        "id": r.id,
        "turn_idx": r.turn_idx,
        "question_text": r.question_text,
        "answer_text": r.answer_text or "",
        "ai_score": float(r.ai_score) if r.ai_score is not None else None,
        "ai_feedback": r.ai_feedback or {},
        "human_score_override": float(r.human_score_override) if r.human_score_override is not None else None,
        "human_comment": r.human_comment or "",
        "created_at": _iso(r.created_at) or "",
    }


def _learner_to_dict(l: Learner) -> dict[str, Any]:
    return {
        "id": l.id,
        "name": l.name,
        "dept": l.dept or "",
        "external_ref": l.external_ref or "",
        "created_at": _iso(l.created_at) or "",
    }


async def _assignment_learner_name(session: AsyncSession, a: AssessmentAssignment) -> str:
    learner = await session.get(Learner, a.learner_id)
    return learner.name if learner else ""


async def _calculate_assignment_score(
    session: AsyncSession, assignment_id: int
) -> float:
    rows = (
        await session.execute(
            select(AssessmentResponse).where(
                AssessmentResponse.assignment_id == assignment_id
            )
        )
    ).scalars().all()
    scores: list[float] = []
    for r in rows:
        score = r.human_score_override if r.human_score_override is not None else r.ai_score
        if score is not None:
            scores.append(float(score))
    return sum(scores) / len(scores) if scores else 0.0


# ──────────────────────────────────────────────────────
# Learner CRUD
# ──────────────────────────────────────────────────────
@router.get("/admin/learners")
async def list_learners(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await session.execute(select(Learner).order_by(desc(Learner.id)))).scalars().all()
    return {"items": [_learner_to_dict(l) for l in rows]}


@router.post("/admin/learners")
async def create_learner(
    body: LearnerCreate, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    name = body.name.strip()
    dept = body.dept.strip()
    external_ref = body.external_ref.strip()
    if not name:
        raise HTTPException(400, "name 不能为空")
    if external_ref:
        exists = (
            await session.execute(select(Learner.id).where(Learner.external_ref == external_ref))
        ).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(400, "账号标识已存在")
    l = Learner(name=name, dept=dept, external_ref=external_ref)
    session.add(l)
    await session.commit()
    await session.refresh(l)
    return _learner_to_dict(l)


# ──────────────────────────────────────────────────────
# Template CRUD
# ──────────────────────────────────────────────────────
@router.get("/admin/assessments/templates")
async def list_templates(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (
        await session.execute(select(AssessmentTemplate).order_by(desc(AssessmentTemplate.id)))
    ).scalars().all()
    return {"items": [_template_to_dict(t) for t in rows]}


@router.post("/admin/assessments/templates")
async def create_template(
    body: AssessmentTemplateCreate, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    t = AssessmentTemplate(
        title=body.title.strip(),
        mode=AssessmentMode(body.mode),
        product_id=body.product_id,
        scope=body.scope.model_dump(),
        question_set=[
            _normalize_question(q.model_dump(), idx=i)
            for i, q in enumerate(body.question_set)
        ],
        pass_score=float(body.pass_score),
        time_limit_sec=body.time_limit_sec,
        num_questions=int(body.num_questions),
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return _template_to_dict(t)


def _normalize_question(q: dict[str, Any], idx: int) -> dict[str, Any]:
    return {
        "idx": idx,
        "text": (q.get("text") or "").strip(),
        "rubric": [str(x).strip() for x in (q.get("rubric") or []) if str(x).strip()],
        "ref_chunk_ids": [int(x) for x in (q.get("ref_chunk_ids") or []) if str(x).lstrip("-").isdigit()],
        "ref_kp_ids": [int(x) for x in (q.get("ref_kp_ids") or []) if str(x).lstrip("-").isdigit()],
    }


def _normalize_int_ids(values: list[Any] | None) -> list[int]:
    return [int(x) for x in (values or []) if str(x).lstrip("-").isdigit()]


@router.get("/admin/assessments/templates/{template_id}")
async def get_template(
    template_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    t = await session.get(AssessmentTemplate, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    return _template_to_dict(t)


@router.patch("/admin/assessments/templates/{template_id}")
async def patch_template(
    template_id: int,
    body: AssessmentTemplatePatch,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    t = await session.get(AssessmentTemplate, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    if body.title is not None:
        t.title = body.title.strip()
    if body.mode is not None:
        t.mode = AssessmentMode(body.mode)
    if body.product_id is not None:
        t.product_id = body.product_id
    if body.scope is not None:
        t.scope = body.scope.model_dump()
    if body.question_set is not None:
        t.question_set = [
            _normalize_question(q.model_dump(), idx=i) for i, q in enumerate(body.question_set)
        ]
    if body.pass_score is not None:
        t.pass_score = float(body.pass_score)
    if body.time_limit_sec is not None:
        t.time_limit_sec = body.time_limit_sec
    if body.num_questions is not None:
        t.num_questions = int(body.num_questions)
    await session.commit()
    await session.refresh(t)
    return _template_to_dict(t)


@router.post("/admin/assessments/templates/{template_id}/generate-questions")
async def generate_questions(
    template_id: int,
    body: GenerateQuestionsRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    t = await session.get(AssessmentTemplate, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    if body.scope_kp_ids is not None:
        kp_ids = _normalize_int_ids(body.scope_kp_ids)
    else:
        scope = t.scope or {}
        kp_ids = _normalize_int_ids(scope.get("kp_ids") or [])
    if not kp_ids:
        raise HTTPException(400, "scope.kp_ids 为空，无法生成题目")
    drafts = await generate_bank_questions(
        scope_kp_ids=kp_ids, num=int(body.num), difficulty=body.difficulty
    )
    return {"questions": drafts}


# ──────────────────────────────────────────────────────
# 分配（一次性 token 链接）
# ──────────────────────────────────────────────────────
@router.post("/admin/assessments/assign")
async def create_assignments(
    body: AssignmentCreateRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    t = await session.get(AssessmentTemplate, body.template_id)
    if not t:
        raise HTTPException(404, "template not found")
    learners = (
        await session.execute(select(Learner).where(Learner.id.in_(body.learner_ids)))
    ).scalars().all()
    if len(learners) != len(set(body.learner_ids)):
        raise HTTPException(400, "部分 learner_id 不存在")

    due_at: datetime | None = None
    if body.due_at:
        try:
            due_at = datetime.fromisoformat(body.due_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "due_at 不是合法 ISO 时间")

    created: list[tuple[AssessmentAssignment, str]] = []
    for lid in body.learner_ids:
        name = next((l.name for l in learners if l.id == lid), "")
        a = AssessmentAssignment(
            template_id=t.id,
            learner_id=lid,
            token=secrets.token_urlsafe(24),
            due_at=due_at,
            status=AssignmentStatus.pending,
        )
        session.add(a)
        created.append((a, name))
    await session.commit()
    for a, _ in created:
        await session.refresh(a)
    return {"items": [_assignment_to_dict(a, learner_name=n) for a, n in created]}


@router.get("/admin/assessments/assignments")
async def list_assignments(
    template_id: int | None = Query(None),
    learner_id: int | None = Query(None),
    status: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = (
        select(AssessmentAssignment, Learner.name)
        .join(Learner, Learner.id == AssessmentAssignment.learner_id)
        .order_by(desc(AssessmentAssignment.id))
    )
    if template_id is not None:
        stmt = stmt.where(AssessmentAssignment.template_id == template_id)
    if learner_id is not None:
        stmt = stmt.where(AssessmentAssignment.learner_id == learner_id)
    if status:
        stmt = stmt.where(AssessmentAssignment.status == status)
    rows = (await session.execute(stmt)).all()
    return {"items": [_assignment_to_dict(a, learner_name=n) for a, n in rows]}


@router.get("/admin/assessments/assignments/{assignment_id}")
async def get_assignment_detail(
    assignment_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    a = await session.get(AssessmentAssignment, assignment_id)
    if not a:
        raise HTTPException(404, "assignment not found")
    learner = await session.get(Learner, a.learner_id)
    template = await session.get(AssessmentTemplate, a.template_id)
    resps = (
        await session.execute(
            select(AssessmentResponse)
            .where(AssessmentResponse.assignment_id == a.id)
            .order_by(AssessmentResponse.turn_idx)
        )
    ).scalars().all()
    out = _assignment_to_dict(a, learner_name=learner.name if learner else "")
    out["template"] = _template_to_dict(template) if template else None
    out["responses"] = [_response_to_dict(r) for r in resps]
    return out


@router.post("/admin/assessments/assignments/{assignment_id}/override")
async def override_response(
    assignment_id: int,
    body: AssignmentOverrideRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    a = await session.get(AssessmentAssignment, assignment_id)
    if not a:
        raise HTTPException(404, "assignment not found")
    r = await session.get(AssessmentResponse, body.response_id)
    if not r or r.assignment_id != a.id:
        raise HTTPException(404, "response not found")
    r.human_score_override = float(body.human_score)
    r.human_comment = body.comment or ""

    # 重算 assignment 总分：每题取 override 优先、AI 分次之
    all_resps = (
        await session.execute(
            select(AssessmentResponse).where(AssessmentResponse.assignment_id == a.id)
        )
    ).scalars().all()
    scores: list[float] = []
    for rr in all_resps:
        s = rr.human_score_override if rr.human_score_override is not None else rr.ai_score
        if s is not None:
            scores.append(float(s))
    if scores:
        a.score = sum(scores) / len(scores)
    await session.commit()
    await session.refresh(a)
    await session.refresh(r)
    return {"assignment": _assignment_to_dict(a), "response": _response_to_dict(r)}


@router.post("/admin/assessments/assignments/{assignment_id}/regenerate-link")
async def regenerate_link(
    assignment_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    a = await session.get(AssessmentAssignment, assignment_id)
    if not a:
        raise HTTPException(404, "assignment not found")
    a.token = secrets.token_urlsafe(24)
    # 重新生成链接 → 重置 status 与时间戳（demo：相当于催办式重派）
    a.status = AssignmentStatus.pending
    a.started_at = None
    a.submitted_at = None
    a.graded_at = None
    a.score = None
    await session.execute(
        AssessmentResponse.__table__.delete().where(
            AssessmentResponse.assignment_id == a.id
        )
    )
    await session.commit()
    await session.refresh(a)
    return _assignment_to_dict(a)


@router.post("/admin/assessments/assignments/{assignment_id}/stop")
async def stop_assignment(
    assignment_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    a = await session.get(AssessmentAssignment, assignment_id)
    if not a:
        raise HTTPException(404, "assignment not found")
    if a.status == AssignmentStatus.graded:
        raise HTTPException(409, "已完成考核不能停止")
    if a.status != AssignmentStatus.stopped:
        a.status = AssignmentStatus.stopped
        await session.commit()
        await session.refresh(a)
    return _assignment_to_dict(a, learner_name=await _assignment_learner_name(session, a))


@router.post("/admin/assessments/assignments/{assignment_id}/finish")
async def finish_assignment(
    assignment_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    a = await session.get(AssessmentAssignment, assignment_id)
    if not a:
        raise HTTPException(404, "assignment not found")
    if a.status == AssignmentStatus.stopped:
        raise HTTPException(409, "已停止考核不能结束，请先催办重置后再处理")
    if a.status != AssignmentStatus.graded:
        now = datetime.utcnow()
        a.score = await _calculate_assignment_score(session, a.id)
        a.status = AssignmentStatus.graded
        if a.submitted_at is None:
            a.submitted_at = now
        a.graded_at = now
        await session.commit()
        await session.refresh(a)
    return _assignment_to_dict(a, learner_name=await _assignment_learner_name(session, a))


# ──────────────────────────────────────────────────────
# 聚合统计
# ──────────────────────────────────────────────────────
@router.get("/admin/assessments/stats")
async def assessment_stats(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    # by template (≈ by product 的近似；product_id 可空，所以按 template 更稳)
    template_rows = (
        await session.execute(
            select(
                AssessmentTemplate.id,
                AssessmentTemplate.title,
                AssessmentTemplate.product_id,
                func.count(AssessmentAssignment.id),
                func.avg(AssessmentAssignment.score),
                func.sum(
                    case(
                        (AssessmentAssignment.status == AssignmentStatus.graded.value, 1),
                        else_=0,
                    )
                ),
            )
            .outerjoin(
                AssessmentAssignment,
                AssessmentAssignment.template_id == AssessmentTemplate.id,
            )
            .group_by(AssessmentTemplate.id)
        )
    ).all()

    by_template = [
        {
            "template_id": tid,
            "title": title,
            "product_id": pid,
            "assigned": int(cnt or 0),
            "graded": int(graded or 0),
            "avg_score": float(avg) if avg is not None else None,
        }
        for tid, title, pid, cnt, avg, graded in template_rows
    ]

    # by learner
    learner_rows = (
        await session.execute(
            select(
                Learner.id,
                Learner.name,
                func.count(AssessmentAssignment.id),
                func.avg(AssessmentAssignment.score),
            )
            .outerjoin(
                AssessmentAssignment, AssessmentAssignment.learner_id == Learner.id
            )
            .group_by(Learner.id)
        )
    ).all()
    by_learner = [
        {
            "learner_id": lid,
            "name": name,
            "assigned": int(cnt or 0),
            "avg_score": float(avg) if avg is not None else None,
        }
        for lid, name, cnt, avg in learner_rows
    ]

    # by kp：把 ai_feedback.kp_tags 拍平。demo 阶段不在 SQL 里 JSON 抽字段，
    # 直接 Python 聚合一次。
    resp_rows = (
        await session.execute(
            select(AssessmentResponse.ai_feedback, AssessmentResponse.ai_score,
                   AssessmentResponse.human_score_override)
        )
    ).all()
    kp_acc: dict[int, list[float]] = {}
    for fb, ai_s, hs in resp_rows:
        fb = fb or {}
        score = hs if hs is not None else ai_s
        if score is None:
            continue
        for kid in (fb.get("kp_tags") or []):
            try:
                kpi = int(kid)
            except (TypeError, ValueError):
                continue
            kp_acc.setdefault(kpi, []).append(float(score))
    by_kp = [
        {"kp_id": k, "count": len(v), "avg_score": sum(v) / len(v)}
        for k, v in sorted(kp_acc.items())
    ]
    return {"by_template": by_template, "by_learner": by_learner, "by_kp": by_kp}
