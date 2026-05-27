import re

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..graphs._retrieval import (
    UnknownProductError,
    _resolve_product_doc_ids,
    fetch_chunks_by_kp_ids,
)
from ..graphs.qa_graph import (
    build_citations,
    build_kb_messages,
    generate_followups,
    iter_context,
    qa_model,
    verify_answer,
)
from ..llm import build_chat_model
from ..schemas import QARequest
from ..sse import split_text_and_json, sse_event, stream_tokens_until_marker

router = APIRouter()


async def _stream_answer(model, messages):
    """跑一次 model.astream，作为异步生成器实时 yield SSE token 字符串。
    末尾再 yield 一次 ("__final__", (answer, used_indices, tagged_kp_ids))。

    调方按 async for 消费；token 字符串可立即转 SSE 事件下发，保证流式体验。
    """
    full_text = ""
    async for kind, payload in stream_tokens_until_marker(model.astream(messages)):
        if kind == "token":
            yield ("token", payload)
        elif kind == "full":
            full_text = payload
    answer, meta = split_text_and_json(full_text)
    meta = meta if isinstance(meta, dict) else {}
    used_indices = [
        int(x)
        for x in (meta.get("used_chunk_indices") or [])
        if isinstance(x, (int, str)) and str(x).isdigit()
    ]
    tagged_kp_ids = [
        int(x)
        for x in (meta.get("tagged_kp_ids") or [])
        if isinstance(x, (int, str)) and str(x).isdigit()
    ]
    yield ("__final__", (answer, used_indices, tagged_kp_ids))


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

            # === 第一次 stream ===
            answer = ""
            used_indices: list[int] = []
            tagged_kp_ids: list[int] = []
            async for kind, payload in _stream_answer(model, ctx.messages):
                if kind == "token":
                    yield sse_event("token", {"text": payload})
                elif kind == "__final__":
                    answer, used_indices, tagged_kp_ids = payload

            # 当前生效的 citations / top_chunks / tagged_kps（reflection 时会被替换）
            current_citations = ctx.citations
            current_top = ctx.top_chunks
            current_tagged = ctx.tagged_kps

            # 用 LLM 自报的 tagged_kp_ids 过滤一遍 tagged_kps
            if tagged_kp_ids:
                current_tagged = [k for k in current_tagged if k["kp_id"] in tagged_kp_ids]

            # 经验回答模式：不做 [n] 校验，也不进 reflection
            if ctx.answer_mode == "experience":
                verdict = {"ok": True, "mode": "experience"}
                final_answer = answer or "（这个问题我手里暂时没有可靠资料。）"
                raw_answer = None
            else:
                verdict = verify_answer(answer, current_citations, used_indices, current_top)

                # === Reflection 二轮：仅在 should_retry 且功能开启时 ===
                if (
                    settings.verifier_reflection_enabled
                    and verdict.get("should_retry")
                    and verdict.get("missed_core_kps")
                ):
                    missed = verdict["missed_core_kps"]
                    missed_kp_ids = [int(k["kp_id"]) for k in missed]
                    missed_kp_names = [k.get("name") or "" for k in missed]
                    # 推 revising 事件，前端清空当前 token 缓冲、展示 banner
                    yield sse_event(
                        "revising",
                        {"reason": "missed_core_kps", "missed_kps": missed},
                    )
                    # 拿 missed KP 的支持 chunks（按 product 过滤）
                    product_code = (req.product_id or "").strip() or None
                    try:
                        _pid, product_doc_ids = await _resolve_product_doc_ids(product_code)
                    except (UnknownProductError, Exception):
                        product_doc_ids = None
                    extra_chunks = []
                    try:
                        extra_chunks = await fetch_chunks_by_kp_ids(
                            missed_kp_ids,
                            product_doc_ids,
                            per_kp_limit=settings.verifier_reflection_per_kp_chunks,
                            total_limit=settings.verifier_reflection_max_kp_chunks,
                        )
                    except Exception:
                        # 拉支持 chunk 失败：放弃 reflection，沿用首答 verdict
                        extra_chunks = []

                    if extra_chunks:
                        # 去重：避免把已在 current_top 里的 chunk 又叠一遍
                        seen_cids = {int(c["chunk_id"]) for c in current_top}
                        deduped_extras = [
                            c for c in extra_chunks if int(c["chunk_id"]) not in seen_cids
                        ]
                        extended_top = list(current_top) + deduped_extras
                        # 重新发 citations（编号扩展），前端按"覆盖"语义接
                        current_citations = build_citations(extended_top)
                        yield sse_event("citations", {"items": current_citations})

                        # 重建 messages，注入 missed KP 名字到 prompt 硬性规则
                        new_msgs = build_kb_messages(req, extended_top, missed_kp_names)
                        # 第二次 stream
                        answer2 = ""
                        used2: list[int] = []
                        tagged2: list[int] = []
                        async for kind, payload in _stream_answer(model, new_msgs):
                            if kind == "token":
                                yield sse_event("token", {"text": payload})
                            elif kind == "__final__":
                                answer2, used2, tagged2 = payload

                        # 用扩展后的素材再 verify；不再继续 retry
                        verdict2 = verify_answer(answer2, current_citations, used2, extended_top)
                        # 二轮的 verdict 标记 revised，把首轮 verdict 留底便于诊断
                        verdict2["revised"] = True
                        verdict2["first_verdict"] = {
                            k: v for k, v in verdict.items() if k != "first_verdict"
                        }
                        verdict = verdict2
                        answer = answer2
                        used_indices = used2
                        current_top = extended_top
                        # tagged_kps 也按二轮 LLM 自报刷一遍：合并候选池里所有 KP，再用 tagged2 过滤
                        kp_acc: dict[int, dict] = {}
                        for c in current_top:
                            chunk_score = max(0.0, min(1.0, float(c.get("score") or 0.0)))
                            for kp in c.get("kps", []):
                                link_rel = float(kp.get("link_relevance") or 0.5)
                                conf = chunk_score * link_rel
                                kid = int(kp["kp_id"])
                                if kid not in kp_acc or kp_acc[kid]["confidence"] < conf:
                                    kp_acc[kid] = {
                                        "kp_id": kid,
                                        "name": kp.get("name", ""),
                                        "confidence": round(conf, 4),
                                    }
                        current_tagged = sorted(
                            kp_acc.values(), key=lambda x: x["confidence"], reverse=True
                        )
                        if tagged2:
                            current_tagged = [k for k in current_tagged if k["kp_id"] in tagged2]

                # ok 判定（可能来自首轮或二轮）
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

            # 从最终答案文本里解析 [n] 作为权威引用集
            referenced = {int(m) for m in re.findall(r"\[(\d+)\]", final_answer)}
            final_citations = [c for c in current_citations if c.get("index") in referenced]

            yield sse_event(
                "result",
                {
                    "answer": final_answer,
                    "raw_answer": raw_answer,
                    "citations": final_citations,
                    "used_indices": used_indices,
                    "tagged_kps": current_tagged,
                    "followups": [],
                    "verify": verdict,
                    "answer_mode": ctx.answer_mode,
                    "closest_match": ctx.closest_match,
                },
            )

            # 仅在 verifier 通过时生成追问
            if verdict.get("ok"):
                last_user = ""
                for m in reversed(req.messages):
                    if m.role == "user":
                        last_user = m.content
                        break
                followups = await generate_followups(last_user, final_answer, current_citations)
                if followups:
                    yield sse_event("followups", {"items": followups})
        except Exception as e:
            yield sse_event("error", {"message": str(e)})
        finally:
            yield sse_event("done", {})

    return EventSourceResponse(gen())
