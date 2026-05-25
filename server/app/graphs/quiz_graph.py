"""AIQuiz 图。两个 entrypoint:
- generate: 出 5 题（非流式 JSON）
- grade: 流式输出 comment 文本 + 末尾结构化 JSON
"""
from __future__ import annotations

import json
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage
from langgraph.graph import StateGraph, START, END

from ..llm import build_chat_model
from ..schemas import QuizGenerateRequest, QuizGradeRequest
from ..sse import JSON_START, JSON_END


# ── Generate ──────────────────────────────────────────
class GenState(TypedDict, total=False):
    request: QuizGenerateRequest
    messages: list[BaseMessage]


def _gen_system(req: QuizGenerateRequest) -> str:
    C = req.customer
    compact = json.dumps(req.knowledge, ensure_ascii=False)
    return f"""你是销售训练教练。请基于知识库和客户人设，生成 {req.count} 个客户会真的问出口的提问，用来突击考员工。

【客户人设】
{C.get('name')}，{C.get('age', '')}岁，{C.get('job', '')}，{C.get('tagline', '')}。
背景：{C.get('context', '')}。
个性：{'、'.join(C.get('personality') or [])}。
关心：{'、'.join((c.get('tag', '') for c in (C.get('concerns') or [])))}。

【题型要求】
- 覆盖至少 3 种类型：参数 / 异议 / 对比 / 应用
- 每题来自不同 KP
- 完全贴合人设口吻，一句话 ≤ 35 字

【知识范围】
{compact}

【严格 JSON 输出，不要 markdown 代码块】
{{"questions": [
  {{"id": "q1", "text": "客户问题文本", "type": "参数|异议|对比|应用", "primaryKpId": "kpX-Y", "tone": "neutral|concern|challenge|interested"}}
]}}"""


def _gen_prepare(state: GenState) -> GenState:
    req = state["request"]
    return {
        "request": req,
        "messages": [
            SystemMessage(content=_gen_system(req)),
            HumanMessage(content=f"请基于 {req.customer.get('name')} 的人设和顾虑，生成 {req.count} 道题。"),
        ],
    }


_gb = StateGraph(GenState)
_gb.add_node("prepare", _gen_prepare)
_gb.add_edge(START, "prepare")
_gb.add_edge("prepare", END)
gen_graph = _gb.compile()


def prepare_generate(req: QuizGenerateRequest) -> list[BaseMessage]:
    return gen_graph.invoke({"request": req})["messages"]


def gen_model():
    return build_chat_model(streaming=False, temperature=0.7)


# ── Grade ─────────────────────────────────────────────
class GradeState(TypedDict, total=False):
    request: QuizGradeRequest
    messages: list[BaseMessage]


def _grade_system(req: QuizGradeRequest) -> str:
    q = req.question
    kp = req.kp or {}
    point = kp.get("point") or {}
    module = kp.get("module") or {}
    rebuttals_str = "\n".join(
        f"参考异议处理：{r.get('q', '')} → {r.get('approach', '')}"
        for r in (point.get("rebuttals") or [])
    )
    return f"""你是销售训练教练。学员正在做"客户突击"训练，请评估这个回答。

【客户问题】"{q.get('text', '')}"（{q.get('type', '')}类）

【关联知识点 · {point.get('title', '')}】
参数事实：{point.get('spec', '')}
销售应用思路：{point.get('sales', '')}
{f"客户视角金句：{point.get('customerVoice')}" if point.get('customerVoice') else ''}
{rebuttals_str}

【学员答案】"{req.student_answer}"

【输出格式 —— 严格遵守】
1. 先输出 1-2 句话点评（纯文本，60-150 字，可分段，不要 markdown 代码块）。
2. 之后另起一行输出结构化标记块（前端会剥离）：
{JSON_START}{{"rating":"good|mid|bad","missing":"可选，缺什么 或 加分项，≤30字","referenceAnswer":"标杆答案 40-100 字，可换行","citations":["相关 kp id"]}}{JSON_END}

评估维度：核心信息 / 数据具体 / 共情顾虑 / 不套话不贬低。"""


def _grade_prepare(state: GradeState) -> GradeState:
    req = state["request"]
    return {
        "request": req,
        "messages": [
            SystemMessage(content=_grade_system(req)),
            HumanMessage(content="请评分。"),
        ],
    }


_grb = StateGraph(GradeState)
_grb.add_node("prepare", _grade_prepare)
_grb.add_edge(START, "prepare")
_grb.add_edge("prepare", END)
grade_graph = _grb.compile()


def prepare_grade(req: QuizGradeRequest) -> list[BaseMessage]:
    return grade_graph.invoke({"request": req})["messages"]


def grade_model():
    return build_chat_model(streaming=True, temperature=0.4)
