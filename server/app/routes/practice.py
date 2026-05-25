from __future__ import annotations

import json
import re

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..schemas import PracticeTurnRequest
from ..graphs.practice_graph import prepare, customer_model, coach_model
from ..sse import sse_event

router = APIRouter()


def _clamp(v, lo, hi):
    try:
        v = int(v)
    except Exception:
        v = 0
    return max(lo, min(hi, v))


def _parse_coach(raw: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", raw or "")
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


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
