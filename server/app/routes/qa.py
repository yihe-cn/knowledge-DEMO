import re

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..graphs.qa_graph import generate_followups, iter_context, qa_model, verify_answer
from ..llm import build_chat_model
from ..schemas import QARequest
from ..sse import split_text_and_json, sse_event, stream_tokens_until_marker

router = APIRouter()


@router.post("/qa")
async def qa_endpoint(req: QARequest):
    async def gen():
        try:
            ctx = None
            async for kind, payload in iter_context(req):
                if kind == "stage":
                    yield sse_event("stage", payload)
                else:  # "context"
                    ctx = payload

            # 先把 citations + tagged_kps + answer_mode 推给前端，便于在 token 流之前渲染骨架
            yield sse_event("citations", {"items": ctx.citations})
            yield sse_event("tagged_kps", {"items": ctx.tagged_kps})
            yield sse_event("answer_mode", {"mode": ctx.answer_mode})

            if ctx.answer_mode == "experience":
                model = build_chat_model(
                    streaming=True,
                    model_name=settings.experience_model or None,
                    temperature=settings.experience_temperature,
                )
            else:
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

            # 经验回答模式不走 citation 校验：它本来就没有 [n] 引用，
            # 让正文原样下发；信任由 prompt 中的"不要编造具体事实"约束承担。
            if ctx.answer_mode == "experience":
                verdict = {"ok": True, "mode": "experience"}
                final_answer = answer or "（这个问题我手里暂时没有可靠资料。）"
                raw_answer = None
            else:
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

            # 从最终答案文本里解析 [n] 作为权威引用集,不信任 LLM 自报的
            # used_chunk_indices(可能漏报或虚报)。fallback 文本里通常没有 [n],
            # 自然得到空 citations。
            referenced = {int(m) for m in re.findall(r"\[(\d+)\]", final_answer)}
            final_citations = [c for c in ctx.citations if c.get("index") in referenced]

            # 先发 result 让前端立刻定稿（答案 + 引用 + 解锁输入框），
            # followups 走单独事件异步推送，避免 LLM 二次调用阻塞主流程。
            yield sse_event(
                "result",
                {
                    "answer": final_answer,
                    "raw_answer": raw_answer,
                    "citations": final_citations,
                    "used_indices": used_indices,
                    "tagged_kps": ctx.tagged_kps,
                    "followups": [],  # 占位，实际通过 followups 事件后补
                    "verify": verdict,
                    "answer_mode": ctx.answer_mode,
                    "closest_match": ctx.closest_match,
                },
            )

            # 仅在 verifier 通过时生成追问,避免基于不可信答案诱导用户继续提问
            if verdict.get("ok"):
                last_user = ""
                for m in reversed(req.messages):
                    if m.role == "user":
                        last_user = m.content
                        break
                followups = await generate_followups(last_user, final_answer, ctx.citations)
                if followups:
                    yield sse_event("followups", {"items": followups})
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())
