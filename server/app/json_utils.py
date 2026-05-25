"""LLM JSON 输出解析工具。

模型偶尔会在 JSON 前后输出说明文字，或在同一段里给"示例 + 真实输出"两个 `{...}` 块。
单纯用贪婪正则 `\\{[\\s\\S]*\\}` 会把头尾的两个 `{` 一起吃掉解析失败；
单纯取"第一个成功 JSON"又可能把示例块当成真实输出。

此处用 JSONDecoder.raw_decode 扫描所有 `{` / `[` 候选位置，收集所有能成功解析的对象，
再按调用方给的 `prefer_keys`（期望出现的字段集合）挑最匹配的一个。
没指定 prefer_keys 时取最后一个成功对象（一般模型会先输出示例后输出真实结果）。
"""
from __future__ import annotations

import json
from typing import Any, Iterable, NamedTuple


_decoder = json.JSONDecoder()


class JsonSpan(NamedTuple):
    """一个成功解析的 JSON 对象及其在原文里的位置。"""
    obj: Any
    start: int
    end: int


def all_json_spans(text: str) -> list[JsonSpan]:
    """从文本中找所有能解析的 JSON 对象 / 数组（不重叠），保留起止偏移。"""
    out: list[JsonSpan] = []
    if not text:
        return out
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch in "{[":
            try:
                obj, end = _decoder.raw_decode(text, i)
            except json.JSONDecodeError:
                i += 1
                continue
            out.append(JsonSpan(obj, i, end))
            i = end  # 跳过该对象，避免子对象被重复识别
            continue
        i += 1
    return out


def all_json_objects(text: str) -> list[Any]:
    """all_json_spans 的便捷版本：只要解析结果，不要 span。"""
    return [s.obj for s in all_json_spans(text)]


def _score(obj: Any, prefer_keys: Iterable[str]) -> int:
    """obj 在 prefer_keys 上的命中数；非 dict 计 0。"""
    if not isinstance(obj, dict):
        return 0
    return sum(1 for k in prefer_keys if k in obj)


def extract_first_json(text: str) -> Any | None:
    """提取第一个能解析的 JSON。失败返回 None。"""
    spans = all_json_spans(text)
    return spans[0].obj if spans else None


def parse_llm_json(
    raw: str | None,
    default: Any = None,
    *,
    prefer_keys: Iterable[str] = (),
) -> Any:
    """LLM 输出解 JSON：
      - 如果给了 prefer_keys 且某个候选对其命中 > 0，挑命中数最多的（并列取后者，倾向"真实输出在后"）。
      - 给了 prefer_keys 但**所有候选命中都是 0** → 返回 default（不把无关 JSON 当结构化输出）。
      - 没给 prefer_keys → 取最后一个能解析的对象。
      - 都没找到返回 default。
    """
    spans = all_json_spans(raw or "")
    if not spans:
        return default
    objs = [s.obj for s in spans]
    if prefer_keys:
        keys = tuple(prefer_keys)
        best_idx = -1
        best_score = 0  # 严格 > 0 才算命中
        for i in range(len(objs) - 1, -1, -1):
            s = _score(objs[i], keys)
            if s > best_score:
                best_score = s
                best_idx = i
        if best_idx >= 0:
            return objs[best_idx]
        return default
    return objs[-1]
