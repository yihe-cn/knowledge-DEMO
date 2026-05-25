"""Practice 角色扮演图。
节点：prepare_context → customer_reply（流式）→ coach_evaluate（结构化 JSON）。

LangGraph 主要负责把"上下文准备 / 客户应答 / 教练打分"三步固定下来；
流式 token 由路由层在 customer_reply 阶段拉取，evaluate 阶段产出 result。
"""
from __future__ import annotations

import json
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage
from langgraph.graph import StateGraph, START, END

from ..llm import build_chat_model
from ..schemas import PracticeTurnRequest


class PracticeState(TypedDict, total=False):
    request: PracticeTurnRequest
    customer_messages: list[BaseMessage]
    coach_messages: list[BaseMessage]


def _difficulty_hint(d: str) -> str:
    return {
        "tough": "你今天心情有点烦，对销售比较挑剔，会主动质疑。",
        "gentle": "你今天心情不错，态度较温和，但仍然理性。",
    }.get(d, "你态度中性，理性。")


def _transcript(history: list[dict[str, Any]], extra_student: str | None = None) -> str:
    lines = []
    for h in history:
        role = h.get("role")
        if role == "system":
            continue
        text = h.get("text", "")
        prefix = "客户" if role == "customer" else "销售"
        lines.append(f"{prefix}: {text}")
    if extra_student:
        lines.append(f"销售: {extra_student}")
    return "\n".join(lines)


def _prepare(state: PracticeState) -> PracticeState:
    req = state["request"]
    C = req.customer
    mood = req.mood or {}
    kp_lines = "\n".join(
        f"{kp.get('id')}: {kp.get('summary', '')}" for kp in (req.kp_list or [])
    )

    # 客户应答 system prompt
    customer_sys = (
        f"{C.get('promptSeed') or C.get('name', '客户')}的人设。\n\n"
        f"{_difficulty_hint(req.difficulty)}\n\n"
        f"当前你对销售的兴趣度={round(mood.get('interest', 50))}/100, "
        f"信任度={round(mood.get('trust', 50))}/100。\n\n"
        f"销售刚才说：\"{req.student_text}\"\n\n"
        f"请以{C.get('name', '客户')}的口吻输出下一句回应，1-2 句、不超过 60 字，纯文本。"
        f"不要任何前缀、不要 JSON、不要解释。"
    )

    # 教练打分 system prompt（独立调用，非流式）
    coach_sys = (
        f"你是销售训练教练。请评估销售这一轮的表现并预测客户情绪变化。\n\n"
        f"【客户人设】{C.get('name')}，{C.get('tagline', '')}\n"
        f"【知识点清单】（评估销售是否引用）\n{kp_lines}\n\n"
        f"【已有对话】\n{_transcript(req.history, req.student_text)}\n\n"
        f"【严格 JSON 输出，不要 markdown 代码块】\n"
        f"{{\n"
        f'  "finished": false,\n'
        f'  "cites": ["销售这句话明确引用到的知识点 id 数组，可空"],\n'
        f'  "quality": "good | mid | bad",\n'
        f'  "skill": "产品知识 | 异议处理 | 需求挖掘 | 沟通表达 | 推进成交",\n'
        f'  "feedback": "一句话教练点评（≤ 40 字）",\n'
        f'  "delta": {{ "interest": -15~15 整数, "trust": -15~15 整数 }}\n'
        f"}}\n"
        f"评分细则：good=共情+事实+具体；mid=有参数但缺共情；bad=套话/贬低对手/回避。"
        f"当多轮表现良好、推进到试驾/成交时 finished=true。"
    )

    return {
        "request": req,
        "customer_messages": [SystemMessage(content=customer_sys), HumanMessage(content="请回话。")],
        "coach_messages": [SystemMessage(content=coach_sys), HumanMessage(content="请评分。")],
    }


_builder = StateGraph(PracticeState)
_builder.add_node("prepare", _prepare)
_builder.add_edge(START, "prepare")
_builder.add_edge("prepare", END)
practice_graph = _builder.compile()


def prepare(req: PracticeTurnRequest) -> PracticeState:
    return practice_graph.invoke({"request": req})


def customer_model():
    return build_chat_model(streaming=True, temperature=0.8)


def coach_model():
    return build_chat_model(streaming=False, temperature=0.2)
