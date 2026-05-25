"""Token-aware chunker。
策略：先按 RawSection 自然边界（pptx 的 slide 已经是一段语义单元），
section 超出 target 时再按句切。section 小于 target/3 时与下一段合并。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

import tiktoken

from .loaders import RawSection


_TARGET = 400
_OVERLAP = 80
_MIN = 120

_ENC = tiktoken.get_encoding("cl100k_base")
_SENT_SPLIT = re.compile(r"(?<=[。！？!?\.])\s+|\n+")


@dataclass
class Chunk:
    text: str
    token_count: int
    meta: dict = field(default_factory=dict)


def _tok_len(s: str) -> int:
    return len(_ENC.encode(s))


def _split_long(text: str, meta: dict) -> list[Chunk]:
    sentences = [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]
    out: list[Chunk] = []
    cur: list[str] = []
    cur_tok = 0
    for sent in sentences:
        st = _tok_len(sent)
        if cur and cur_tok + st > _TARGET:
            joined = " ".join(cur)
            out.append(Chunk(text=joined, token_count=_tok_len(joined), meta=dict(meta)))
            # overlap：留尾巴几句
            tail: list[str] = []
            tail_tok = 0
            for s in reversed(cur):
                t = _tok_len(s)
                if tail_tok + t > _OVERLAP:
                    break
                tail.insert(0, s)
                tail_tok += t
            cur = tail[:]
            cur_tok = tail_tok
        cur.append(sent)
        cur_tok += st
    if cur:
        joined = " ".join(cur)
        out.append(Chunk(text=joined, token_count=_tok_len(joined), meta=dict(meta)))
    return out


def chunk_sections(sections: Iterable[RawSection]) -> list[Chunk]:
    chunks: list[Chunk] = []
    buffer: list[RawSection] = []
    buffer_tok = 0

    def flush_buffer() -> None:
        nonlocal buffer, buffer_tok
        if not buffer:
            return
        merged_text = "\n\n".join(s.text for s in buffer)
        merged_meta = {
            "slide_indices": [s.meta.get("slide_index") for s in buffer if s.meta.get("slide_index")],
            "titles": [s.meta.get("title", "") for s in buffer],
        }
        if _tok_len(merged_text) > _TARGET:
            chunks.extend(_split_long(merged_text, merged_meta))
        else:
            chunks.append(Chunk(text=merged_text, token_count=_tok_len(merged_text), meta=merged_meta))
        buffer = []
        buffer_tok = 0

    for section in sections:
        st = _tok_len(section.text)
        if st >= _TARGET:
            flush_buffer()
            chunks.extend(_split_long(section.text, {
                "slide_indices": [section.meta.get("slide_index")] if section.meta.get("slide_index") else [],
                "titles": [section.meta.get("title", "")],
            }))
            continue
        buffer.append(section)
        buffer_tok += st
        if buffer_tok >= _MIN:
            flush_buffer()
    flush_buffer()
    return chunks
