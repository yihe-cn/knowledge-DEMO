from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..graphs._retrieval import RetrievalError, UnknownProductError
from ..graphs.evaluation_graph import run_evaluation
from ..graphs.practice_graph import coach_model, customer_model, prepare
from ..graphs.suggestor_graph import GenerationError, generate_suggestions
from ..json_utils import parse_llm_json
from ..schemas import PracticeEvaluateRequest, PracticeSuggestRequest, PracticeTurnRequest
from ..security import require_internal_token
from ..sse import sse_event


logger = logging.getLogger(__name__)

router = APIRouter()

# /practice/suggest 和 /practice/evaluate 都直接调 LLM、成本敏感，
# 放进带鉴权的 router（require_internal_token）。
suggest_router = APIRouter(dependencies=[Depends(require_internal_token)])


def _clamp(v, lo, hi):
    try:
        v = int(v)
    except Exception:
        v = 0
    return max(lo, min(hi, v))


def _parse_coach(raw: str) -> dict:
    data = parse_llm_json(raw, default={}, prefer_keys=("quality", "delta", "feedback"))
    return data if isinstance(data, dict) else {}


@router.post("/practice/turn")
async def practice_turn(req: PracticeTurnRequest):
    state = prepare(req)
    cm = customer_model()
    coach = coach_model()

    async def gen():
        try:
            # 1) 流式客户回话
            customer_text = ""
            async for chunk in cm.astream(state["customer_messages"]):
                piece = getattr(chunk, "content", "") or ""
                if piece:
                    customer_text += piece
                    yield sse_event("token", {"text": piece})

            # 2) 同步取教练打分
            coach_resp = await coach.ainvoke(state["coach_messages"])
            data = _parse_coach(getattr(coach_resp, "content", "") or "")

            delta = data.get("delta") or {}
            result = {
                "customerReply": customer_text.strip() or "嗯。",
                "finished": bool(data.get("finished")),
                "cites": data.get("cites") if isinstance(data.get("cites"), list) else [],
                "quality": data.get("quality") if data.get("quality") in ("good", "mid", "bad") else "mid",
                "skill": data.get("skill") or "沟通表达",
                "feedback": data.get("feedback") or "回应已收到。",
                "delta": {
                    "interest": _clamp(delta.get("interest", 0), -15, 15),
                    "trust": _clamp(delta.get("trust", 0), -15, 15),
                },
            }
            yield sse_event("result", result)
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())


@suggest_router.post("/practice/evaluate")
async def practice_evaluate(req: PracticeEvaluateRequest) -> dict:
    """整场练后评估报告。非流式，一次性返回完整 JSON。

    错误语义：内部异常一律 503 + 通用文案，原始细节只写日志，不回给前端。
    """
    try:
        return await run_evaluation(req)
    except Exception as e:  # noqa: BLE001
        logger.exception("practice_evaluate failed: %s", e)
        raise HTTPException(status_code=503, detail="评估生成暂时不可用，请稍后再试")


@suggest_router.post("/practice/suggest")
async def practice_suggest(req: PracticeSuggestRequest):
    """点 ✦ 时拉一组思路提示。非流式，整组 JSON 返回。

    错误语义：
      - UnknownProductError → 400（前端传了未知 product_code）
      - RetrievalError / GenerationError → 503（基础设施故障）
      - 真"无可生成的建议" → 200 + 空数组
    """
    try:
        return await generate_suggestions(req)
    except UnknownProductError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (RetrievalError, GenerationError) as e:
        logger.warning("practice_suggest infra error: %s", e)
        raise HTTPException(status_code=503, detail=str(e))
