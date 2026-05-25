from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..graphs.qa_graph import build_context, qa_model, verify_answer
from ..schemas import QARequest
from ..sse import split_text_and_json, sse_event, stream_tokens_until_marker

router = APIRouter()


@router.post("/qa")
async def qa_endpoint(req: QARequest):
    async def gen():
        try:
            ctx = await build_context(req)

            # 先把 citations + tagged_kps 推给前端，便于在 token 流之前渲染骨架
            yield sse_event("citations", {"items": ctx.citations})
            yield sse_event("tagged_kps", {"items": ctx.tagged_kps})

            model = qa_model()
            full_text = ""
            async for kind, payload in stream_tokens_until_marker(model.astream(ctx.messages)):
                if kind == "token":
                    yield sse_event("token", {"text": payload})
                elif kind == "full":
                    full_text = payload

            answer, meta = split_text_and_json(full_text)
            meta = meta if isinstance(meta, dict) else {}
            used_indices = [int(x) for x in (meta.get("used_chunk_indices") or []) if isinstance(x, (int, str)) and str(x).isdigit()]
            tagged_kp_ids = [int(x) for x in (meta.get("tagged_kp_ids") or []) if isinstance(x, (int, str)) and str(x).isdigit()]

            # 用 LLM 自报的 tagged_kp_ids 过滤一遍 tagged_kps
            if tagged_kp_ids:
                ctx.tagged_kps = [k for k in ctx.tagged_kps if k["kp_id"] in tagged_kp_ids]

            verdict = verify_answer(answer, ctx.citations, used_indices)

            # Verifier 真正生效：失败时把 result.answer 替换为 fallback 文本，
            # 原始未受信回答保留到 raw_answer 字段供调试，不再让前端默认渲染原文。
            if verdict.get("ok"):
                final_answer = answer
                raw_answer = None
            else:
                final_answer = verdict.get("fallback") or "这个问题我手里暂时没有可靠资料。"
                raw_answer = answer
                yield sse_event(
                    "fallback",
                    {"reason": verdict.get("reason"), "answer": final_answer, "raw_answer": raw_answer},
                )

            yield sse_event(
                "result",
                {
                    "answer": final_answer,
                    "raw_answer": raw_answer,
                    "citations": ctx.citations,
                    "used_indices": used_indices,
                    "tagged_kps": ctx.tagged_kps,
                    "verify": verdict,
                },
            )
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())
