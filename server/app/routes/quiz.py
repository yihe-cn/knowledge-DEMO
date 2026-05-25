from __future__ import annotations

import json
import re

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..schemas import QuizGenerateRequest, QuizGradeRequest
from ..graphs.quiz_graph import (
    prepare_generate,
    gen_model,
    prepare_grade,
    grade_model,
)
from ..sse import sse_event, stream_tokens_until_marker, split_text_and_json

router = APIRouter()


def _parse_json(raw: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", raw or "")
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


_VALID_QUALITIES = ("good", "mid", "bad")


def _normalize_suggested_options(raw) -> list[dict]:
    """LLM 输出宽松归一化：必须凑齐 good/mid/bad 三档且 text 非空，否则返回 []，
    前端见到空数组会隐藏"看选项"按钮，避免渲染无效卡片或把用户卡死在空面板。"""
    if not isinstance(raw, list):
        return []
    picked: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        q = item.get("quality")
        text = item.get("text")
        if q in _VALID_QUALITIES and q not in picked and isinstance(text, str) and text.strip():
            picked[q] = text.strip()
    if len(picked) != 3:
        return []
    return [{"quality": q, "text": picked[q]} for q in _VALID_QUALITIES]


@router.post("/quiz/generate")
async def quiz_generate(req: QuizGenerateRequest):
    messages = prepare_generate(req)
    model = gen_model()

    async def gen():
        try:
            resp = await model.ainvoke(messages)
            data = _parse_json(getattr(resp, "content", "") or "")
            questions = data.get("questions", []) or []
            for q in questions:
                if isinstance(q, dict):
                    q["suggestedOptions"] = _normalize_suggested_options(q.get("suggestedOptions"))
            yield sse_event("result", {"questions": questions})
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())


@router.post("/quiz/grade")
async def quiz_grade(req: QuizGradeRequest):
    messages = prepare_grade(req)
    model = grade_model()

    async def gen():
        try:
            full = ""
            async for kind, payload in stream_tokens_until_marker(model.astream(messages)):
                if kind == "token":
                    yield sse_event("token", {"text": payload})
                elif kind == "full":
                    full = payload
            comment_text, meta = split_text_and_json(full)
            meta = meta or {}
            result = {
                "comment": comment_text,
                "rating": meta.get("rating") if meta.get("rating") in ("good", "mid", "bad") else "mid",
                "missing": meta.get("missing", ""),
                "referenceAnswer": meta.get("referenceAnswer", ""),
                "citations": meta.get("citations") if isinstance(meta.get("citations"), list) else [],
            }
            yield sse_event("result", result)
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())
