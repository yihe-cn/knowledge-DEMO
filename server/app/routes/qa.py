from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..schemas import QARequest
from ..graphs.qa_graph import prepare_messages, qa_model
from ..sse import sse_event, stream_tokens_until_marker, split_text_and_json

router = APIRouter()


@router.post("/qa")
async def qa_endpoint(req: QARequest):
    async def gen():
        try:
            messages = prepare_messages(req)
            model = qa_model()
            full_text = ""
            async for kind, payload in stream_tokens_until_marker(model.astream(messages)):
                if kind == "token":
                    yield sse_event("token", {"text": payload})
                elif kind == "full":
                    full_text = payload
            answer, meta = split_text_and_json(full_text)
            yield sse_event(
                "result",
                {
                    "answer": answer,
                    "citations": (meta or {}).get("citations", []) if isinstance(meta, dict) else [],
                    "followups": (meta or {}).get("followups", []) if isinstance(meta, dict) else [],
                },
            )
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())
