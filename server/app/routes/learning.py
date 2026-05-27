"""学员侧学习闭环：swipe 卡片 + 逐 KP 闭卷答题 + AI 评分。

无 internal token 守门，靠 ?account= 弱身份解析 Learner.external_ref
（与已有的 /api/courses/by-account 一致）。

⚠️ 已知风险 / 技术债（Codex 评审 Problem 2）：
  - account_ref 是猜得到的字符串，任何人知道/猜中就能读写他人进度
    （last_answer / last_score / last_feedback），比只读的 by-account 风险高。
  - 本期沿用此弱身份是 MVP 妥协；正确解法是为 learner 发一次性 token
    （类比 AssessmentAssignment.token），所有写操作必须带 token。
  - 修复入口：新增 LearnerSession 表 + /learning/session 颁发 token；
    将 ?account= 替换为 X-Learner-Token 头。下一期 auth 重设计时处理。

进度写入侧已加了课程编排校验（_assert_kp_in_curriculum）：即使有合法 account，
也不能往该 learner 的课外 KP 写进度，限制了攻击面。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    CourseAssignment,
    CourseAssignmentStatus,
    ExamStatus,
    KpCardContent,
    KpRegistry,
    KpStatus,
    Learner,
    LearnerKpProgress,
    LearnerKpStatus,
    Product,
    ProductKp,
    ProductStatus,
    get_session,
)
from ..schemas import LearningAnswerIn, LearningSkipIn

router = APIRouter()


def _progress_to_dict(p: LearnerKpProgress | None) -> dict[str, Any]:
    if p is None:
        return {
            "status": "unseen",
            "attempts": 0,
            "last_score": None,
            "last_feedback": {},
        }
    status = p.status.value if hasattr(p.status, "value") else str(p.status)
    return {
        "status": status,
        "attempts": int(p.attempts or 0),
        "last_score": p.last_score,
        "last_feedback": dict(p.last_feedback or {}),
    }


async def _resolve_learner(session: AsyncSession, account_ref: str | None) -> Learner | None:
    if not account_ref:
        return None
    return (
        await session.execute(
            select(Learner).where(Learner.external_ref == account_ref)
        )
    ).scalar_one_or_none()


async def _resolve_product_by_code(session: AsyncSession, product_code: str) -> Product:
    p = (
        await session.execute(select(Product).where(Product.code == product_code))
    ).scalar_one_or_none()
    if not p or p.status != ProductStatus.active:
        raise HTTPException(404, f"product {product_code} not found")
    return p


async def _assert_course_assigned(
    session: AsyncSession, *, learner_id: int, product_id: int
) -> None:
    assignment = (
        await session.execute(
            select(CourseAssignment.id)
            .where(CourseAssignment.learner_id == learner_id)
            .where(CourseAssignment.product_id == product_id)
            .where(CourseAssignment.status == CourseAssignmentStatus.active)
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise HTTPException(403, "该课程未分发给当前学员，或访问已停止")


async def _assert_kp_in_curriculum(
    session: AsyncSession, *, product_id: int, kp_id: int
) -> None:
    """确认 kp_id 属于 product_id 的当前课程编排（active product_kp）。
    防止学员往课外 KP 写进度、或借别的 product 的 pass_score。
    """
    pk = (
        await session.execute(
            select(ProductKp.id)
            .where(ProductKp.product_id == product_id)
            .where(ProductKp.kp_id == kp_id)
            .where(ProductKp.removed_at.is_(None))
        )
    ).scalar_one_or_none()
    if pk is None:
        raise HTTPException(404, "该 KP 不在此课程的学习编排中")


@router.get("/learning/courses/{product_code}/cards")
async def list_learning_cards(
    product_code: str,
    account: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """返回 swipe 卡片序列：仅 product_kp 中 active 且 KP 已 approved 的项。

    不返回 rubric（防答案泄露）。card.examQuestion 给学员看，rubric 仅服务端评分用。
    学员端正常会带 account；此时必须匹配 learner 且课程仍为 active 分发。
    若不带 account，则仅返回卡片内容，progress 字段全部按 unseen 返回（仅展示，不持久化）。
    """
    p = await _resolve_product_by_code(session, product_code)
    learner = await _resolve_learner(session, account)
    if account and learner is None:
        raise HTTPException(401, "未找到学员，请检查 account 参数")
    if learner is not None:
        await _assert_course_assigned(session, learner_id=learner.id, product_id=p.id)

    rows = (
        await session.execute(
            select(ProductKp, KpRegistry, KpCardContent)
            .join(KpRegistry, KpRegistry.id == ProductKp.kp_id)
            .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
            .where(ProductKp.product_id == p.id)
            .where(ProductKp.removed_at.is_(None))
            .where(KpRegistry.status == KpStatus.approved)
            .order_by(ProductKp.order_index, ProductKp.id)
        )
    ).all()

    # 一次性加载该 learner 在本 product 下的所有进度
    progress_map: dict[int, LearnerKpProgress] = {}
    if learner is not None and rows:
        kp_ids = [k.id for _, k, _ in rows]
        prog_rows = (
            await session.execute(
                select(LearnerKpProgress)
                .where(LearnerKpProgress.learner_id == learner.id)
                .where(LearnerKpProgress.product_id == p.id)
                .where(LearnerKpProgress.kp_id.in_(kp_ids))
            )
        ).scalars().all()
        progress_map = {pr.kp_id: pr for pr in prog_rows}

    items: list[dict[str, Any]] = []
    for pk, kp, card in rows:
        exam_status = (
            card.exam_status.value
            if card and hasattr(card.exam_status, "value")
            else (str(card.exam_status) if card else "pending")
        )
        items.append(
            {
                "kp_id": kp.id,
                "order_index": pk.order_index,
                "title": kp.name,
                "category": kp.category or "",
                "definition": kp.definition or "",
                # 卡面富字段
                "spec": (card.spec if card else "") or "",
                "customer_voice": (card.customer_voice if card else "") or "",
                "sales": (card.sales if card else "") or "",
                "sources": list((card.sources if card else []) or []),
                "applies_to": list((card.applies_to if card else []) or []),
                "not_applicable": list((card.not_applicable if card else []) or []),
                "rebuttals": list((card.rebuttals if card else []) or []),
                # 考题（脱敏：仅返回题面，不返回 rubric）
                "exam_question": (card.exam_question if card else "") or "",
                "exam_status": exam_status,
                # 学员进度
                "progress": _progress_to_dict(progress_map.get(kp.id)),
            }
        )

    return {
        "product": {
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "pass_score": int(getattr(p, "pass_score", 70) or 70),
        },
        "learner_resolved": learner is not None,
        "items": items,
    }


@router.post("/learning/kp/{kp_id}/answer")
async def submit_learning_answer(
    kp_id: int,
    body: LearningAnswerIn,
    account: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """学员提交单 KP 答案 → 调 LLM 评分 → 写进度。"""
    learner = await _resolve_learner(session, account)
    if learner is None:
        raise HTTPException(401, "未找到学员，请检查 account 参数")

    product = await session.get(Product, body.product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(404, "product not found")
    await _assert_course_assigned(session, learner_id=learner.id, product_id=product.id)

    kp = await session.get(KpRegistry, kp_id)
    if not kp:
        raise HTTPException(404, "kp not found")
    # KP 必须在该 product 的当前课程编排里，且必须 approved 才允许答题
    if kp.status != KpStatus.approved:
        raise HTTPException(400, "该 KP 未发布，无法答题")
    await _assert_kp_in_curriculum(session, product_id=product.id, kp_id=kp_id)

    card = (
        await session.execute(
            select(KpCardContent).where(KpCardContent.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    if card is None or card.exam_status != ExamStatus.ready or not (card.exam_question or "").strip():
        raise HTTPException(400, "该 KP 尚未准备好考题，请联系管理员")

    # 复用现有 score_bank_answer
    from ..graphs.assessment_graph import score_bank_answer

    # 回放生成时记录的 ref_chunk_ids/ref_kp_ids，让 score_bank_answer 能加载素材作参考
    feedback = await score_bank_answer(
        question_text=card.exam_question,
        rubric=list(card.exam_rubric or []),
        ref_chunk_ids=[int(c) for c in (card.exam_ref_chunk_ids or []) if isinstance(c, (int, str)) and str(c).isdigit()],
        ref_kp_ids=[int(k) for k in (card.exam_ref_kp_ids or [kp_id]) if isinstance(k, (int, str)) and str(k).isdigit()] or [kp_id],
        learner_answer=body.answer,
    )
    score = float(feedback.get("score") or 0.0)
    pass_score = int(getattr(product, "pass_score", 70) or 70)
    passed = score >= pass_score

    # upsert 进度
    prog = (
        await session.execute(
            select(LearnerKpProgress)
            .where(LearnerKpProgress.learner_id == learner.id)
            .where(LearnerKpProgress.product_id == product.id)
            .where(LearnerKpProgress.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        prog = LearnerKpProgress(
            learner_id=learner.id,
            product_id=product.id,
            kp_id=kp_id,
            attempts=0,
        )
        session.add(prog)

    prog.attempts = int(prog.attempts or 0) + 1
    prog.status = LearnerKpStatus.passed if passed else LearnerKpStatus.failed
    prog.last_score = score
    prog.last_answer = body.answer
    prog.last_feedback = feedback
    prog.updated_at = datetime.utcnow()

    await session.commit()

    return {
        "passed": passed,
        "score": score,
        "pass_score": pass_score,
        "attempts": prog.attempts,
        "feedback": feedback,
    }


@router.post("/learning/kp/{kp_id}/skip")
async def skip_learning_kp(
    kp_id: int,
    body: LearningSkipIn,
    account: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """学员主动跳过该 KP。不增加 attempts，仅打标。已通过的 KP 不允许覆盖为 skipped。"""
    learner = await _resolve_learner(session, account)
    if learner is None:
        raise HTTPException(401, "未找到学员")

    product = await session.get(Product, body.product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(404, "product not found")
    await _assert_course_assigned(session, learner_id=learner.id, product_id=product.id)
    await _assert_kp_in_curriculum(session, product_id=product.id, kp_id=kp_id)

    prog = (
        await session.execute(
            select(LearnerKpProgress)
            .where(LearnerKpProgress.learner_id == learner.id)
            .where(LearnerKpProgress.product_id == product.id)
            .where(LearnerKpProgress.kp_id == kp_id)
        )
    ).scalar_one_or_none()
    if prog is None:
        prog = LearnerKpProgress(
            learner_id=learner.id,
            product_id=product.id,
            kp_id=kp_id,
            status=LearnerKpStatus.skipped,
        )
        session.add(prog)
    else:
        if prog.status == LearnerKpStatus.passed:
            return {"ok": True, "status": "passed", "note": "已通过，跳过被忽略"}
        prog.status = LearnerKpStatus.skipped
    prog.updated_at = datetime.utcnow()
    await session.commit()
    return {"ok": True, "status": "skipped"}
