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


@router.post("/quiz/generate")
async def quiz_generate(req: QuizGenerateRequest):
    messages = prepare_generate(req)
    model = gen_model()

    async def gen():
        try:
            resp = await model.ainvoke(messages)
            data = _parse_json(getattr(resp, "content", "") or "")
            yield sse_event("result", {"questions": data.get("questions", [])})
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
