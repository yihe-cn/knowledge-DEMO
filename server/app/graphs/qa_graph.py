"""AIQA 单轮问答图。
节点：build_messages → llm_call。流式由路由层用 astream 直接取。
"""
from __future__ import annotations

import json
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage
from langgraph.graph import StateGraph, START, END

from ..llm import build_chat_model
from ..schemas import QARequest
from ..sse import JSON_START, JSON_END


class QAState(TypedDict, total=False):
    request: QARequest
    messages: list[BaseMessage]


def _system_prompt(req: QARequest) -> str:
    meta = req.product_meta or {}
    product_name = meta.get("name", "当前产品")
    aiqa_context = meta.get("aiqaContext", f"{product_name} 销售训练平台的产品私教")
    student_role = meta.get("studentRole", "学员")
    customer_label = meta.get("customerLabel", "客户")
    example_kp = ""
    for m in req.knowledge:
        pts = m.get("points") or []
        if pts:
            example_kp = pts[0].get("id", "")
            break

    return f"""你是{aiqa_context}。
你的职责：用{student_role}能听懂的话，帮他理解产品知识、想清楚{customer_label}对话怎么说。

【硬性边界】
- 只回答{product_name}相关问题。问别的产品/品牌/通用知识，礼貌引导回{product_name}。
- 所有事实必须来自下方知识库。不要编参数、不要瞎讲。
- 知识库没覆盖的，明确说"这个我手里没有官方资料"。

【回答风格】
- 像有耐心的资深同事，不是百科。短答案优先，不堆参数。
- {customer_label}对话相关给"思路 + 一句示范话术"。
- 比较类先讲事实，再讲差异，不贬低竞品。

【输出格式 —— 严格遵守】
1. 先输出可读正文（60-180 字，可分段，纯文本，不要用 markdown 代码块）。
2. 正文之后另起一行，输出以下结构化标记块（前端会剥离）：
{JSON_START}{{"citations":["相关 kp id 数组，示例 {example_kp}，无相关就空数组"],"followups":["{student_role}可能想接着问的 2-3 条短问题，每条 ≤ 16 字"]}}{JSON_END}

【知识库】
{json.dumps(req.knowledge, ensure_ascii=False)}
"""


def _build_messages(state: QAState) -> QAState:
    req = state["request"]
    msgs: list[BaseMessage] = [SystemMessage(content=_system_prompt(req))]
    for m in req.messages:
        if m.role == "user":
            msgs.append(HumanMessage(content=m.content))
        else:
            # assistant 回合也走 HumanMessage 体内角色标签的简化模型——多轮场景由前端拼接
            from langchain_core.messages import AIMessage
            msgs.append(AIMessage(content=m.content))
    return {"request": req, "messages": msgs}


# 简单图：build_messages 节点（LLM 调用在路由层用 astream 流式拉），
# 保留 StateGraph 形态便于后续加入检索、过滤等节点。
_builder = StateGraph(QAState)
_builder.add_node("build_messages", _build_messages)
_builder.add_edge(START, "build_messages")
_builder.add_edge("build_messages", END)
qa_graph = _builder.compile()


def prepare_messages(req: QARequest) -> list[BaseMessage]:
    out = qa_graph.invoke({"request": req})
    return out["messages"]


def qa_model():
    return build_chat_model(streaming=True)
