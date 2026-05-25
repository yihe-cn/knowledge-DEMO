"""文档 loader。MVP 仅实现 pptx；pdf/docx 接口预留。"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RawSection:
    text: str
    meta: dict = field(default_factory=dict)  # 例如 {"slide_index": 3, "title": "..."}


def load_pptx(path: Path) -> list[RawSection]:
    from pptx import Presentation  # type: ignore

    prs = Presentation(str(path))
    sections: list[RawSection] = []
    for idx, slide in enumerate(prs.slides, start=1):
        title = ""
        body_parts: list[str] = []
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            for para in shape.text_frame.paragraphs:
                line = "".join(run.text for run in para.runs).strip()
                if not line:
                    continue
                # 第一段非空且短，视为标题
                if not title and len(line) <= 40:
                    title = line
                else:
                    body_parts.append(line)
        # speaker notes
        notes_text = ""
        try:
            if slide.has_notes_slide:
                notes_text = (slide.notes_slide.notes_text_frame.text or "").strip()
        except Exception:
            notes_text = ""
        composed = "\n".join([title] + body_parts + ([f"[备注]{notes_text}"] if notes_text else [])).strip()
        if composed:
            sections.append(RawSection(text=composed, meta={"slide_index": idx, "title": title}))
    return sections


def load_document(path: str | Path) -> list[RawSection]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    suffix = p.suffix.lower()
    if suffix in {".pptx"}:
        return load_pptx(p)
    raise NotImplementedError(f"loader for {suffix} not implemented (MVP only supports .pptx)")
