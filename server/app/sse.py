"""SSE 事件构造与文本/JSON 分离工具。

约定：模型先输出可读正文，再在末尾追加 `<<<JSON>>>{...}<<<END>>>` 标记包裹的结构化 JSON。
后端流式把正文 token 推给前端，遇到起始标记后停止 token 推送，结束后解析 JSON 推 result。
"""
from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator

JSON_START = "<<<JSON>>>"
JSON_END = "<<<END>>>"


def sse_event(event: str, data: Any) -> dict:
    """sse-starlette EventSourceResponse 期望 dict 形式。"""
    if not isinstance(data, str):
        data = json.dumps(data, ensure_ascii=False)
    return {"event": event, "data": data}


def split_text_and_json(full: str) -> tuple[str, dict | None]:
    """从一段完整文本里剥离尾部 JSON 块，返回 (可读正文, 解析后的 dict 或 None)。"""
    if JSON_START in full:
        head, _, tail = full.partition(JSON_START)
        raw = tail.split(JSON_END, 1)[0].strip()
        try:
            return head.rstrip(), json.loads(raw)
        except Exception:
            pass

    # 回退：尝试把整段当 JSON 解析（模型没遵守标记时）
    m = re.search(r"\{[\s\S]*\}", full)
    if m:
        try:
            return full[: m.start()].rstrip(), json.loads(m.group(0))
        except Exception:
            return full, None
    return full, None


async def stream_tokens_until_marker(astream: AsyncIterator) -> AsyncIterator[tuple[str, str]]:
    """包装 LangChain astream，遇到 `<<<JSON>>>` 起始标记后停止 yield token，
    但继续消费流以便累积完整文本。

    yield 元组 (kind, payload):
      - ("token", 文本片段) — 应推给前端
      - ("full", 完整原始文本) — 在流结束时 yield 一次
    """
    buffer = ""
    emitted_up_to = 0
    suppressing = False

    async for chunk in astream:
        piece = getattr(chunk, "content", None) or ""
        if not piece:
            continue
        buffer += piece

        if not suppressing:
            # 检查标记是否出现
            idx = buffer.find(JSON_START, emitted_up_to)
            if idx >= 0:
                # 推送标记之前还没推的部分
                if idx > emitted_up_to:
                    yield ("token", buffer[emitted_up_to:idx])
                emitted_up_to = idx
                suppressing = True
            else:
                # 为防止把跨片到来的标记前缀提前吐出去，留一段尾巴
                safe_end = max(emitted_up_to, len(buffer) - len(JSON_START))
                if safe_end > emitted_up_to:
                    yield ("token", buffer[emitted_up_to:safe_end])
                    emitted_up_to = safe_end

    # 流结束后，若还有未推送的可读尾巴（且未进入 suppress 阶段），补推
    if not suppressing and emitted_up_to < len(buffer):
        yield ("token", buffer[emitted_up_to:])

    yield ("full", buffer)
