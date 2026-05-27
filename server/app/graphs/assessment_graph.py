"""考核模块的出题 + 评分 graph。

设计取舍：
  - bank 模式出题不走向量检索：从 scope.kp_ids 直接拉关联 chunk（已是 admin 审定过的知识点
    映射），喂给 LLM 让它生成「问题 + 要点 rubric」。
  - 评分也不走 retriever：题面在出题时已经存好了 ref_chunk_ids，直接按 id 加载即可。
  - 复用 qa_graph 的 sanitize 工具防注入；复用 json_utils.parse_llm_json 抗 LLM 啰嗦。
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Any

from sqlalchemy import select

from ..db.models import KbChunk, KpCardContent, KpChunkLink, KpRegistry
from ..db.session import SessionLocal
from ..graphs._retrieval import sanitize_for_fence, sanitize_untrusted
from ..json_utils import parse_llm_json
from ..llm import build_chat_model

_log = logging.getLogger(__name__)

ASSESSMENT_LLM_TIMEOUT_SEC = 35
ORAL_FOCUS_DIMENSIONS = [
    "产品核心价值复述",
    "客户异议处理",
    "需求挖掘与匹配",
    "证据点/数据支撑",
    "边界条件与误区识别",
]


# ──────────────────────────────────────────────────────
# 通用辅助
# ──────────────────────────────────────────────────────
async def _load_chunks_by_kp(kp_ids: list[int], limit_per_kp: int = 5) -> list[dict]:
    """按 kp_id 拉关联 chunk，返回 [{chunk_id, text, kp_id, kp_name}]。"""
    if not kp_ids:
        return []
    async with SessionLocal() as session:
        res = await session.execute(
            select(KpChunkLink, KbChunk, KpRegistry)
            .join(KbChunk, KbChunk.id == KpChunkLink.chunk_id)
            .join(KpRegistry, KpRegistry.id == KpChunkLink.kp_id)
            .where(KpChunkLink.kp_id.in_(kp_ids))
            .order_by(KpChunkLink.kp_id, KpChunkLink.relevance.desc())
        )
        rows = res.all()
    out: list[dict] = []
    per_kp: dict[int, int] = {}
    for link, chunk, kp in rows:
        cur = per_kp.get(kp.id, 0)
        if cur >= limit_per_kp:
            continue
        per_kp[kp.id] = cur + 1
        out.append(
            {
                "chunk_id": chunk.id,
                "text": chunk.text,
                "kp_id": kp.id,
                "kp_name": kp.name,
            }
        )
    return out


async def _load_chunks_by_id(chunk_ids: list[int]) -> list[dict]:
    if not chunk_ids:
        return []
    async with SessionLocal() as session:
        res = await session.execute(select(KbChunk).where(KbChunk.id.in_(chunk_ids)))
        chunks = res.scalars().all()
    return [{"chunk_id": c.id, "text": c.text} for c in chunks]


async def _load_kp_briefs(kp_ids: list[int]) -> list[dict]:
    """按 kp_id 拉 KP 的 name + definition + 富化卡片字段，作为「无 chunks 时」的退化素材。

    富化字段（scenario / customer_voice / applies_to / rebuttals）是 Pass-2 enricher 写入 KpCardContent
    的内容，对纯方法论 KP（没有底层文档 chunk 支撑）出题极有价值——它们替代了原本应该从 chunk 提取的
    业务语境，让 LLM 能出"客户拿我们和特斯拉对比时你会先确认什么"这种具体场景题，而不是泛泛地复述定义。

    返回 [{kp_id, kp_name, definition, scenario, customer_voice, applies_to, rebuttals}]，缺字段时为空串/空列表。
    注意：trigger_questions / aliases 是召回向字段（口语化提问 / 关键词），不适合直接作为出题素材，
    不放进 brief；放进去会让 LLM 把"客户原话"拿来直接当考题题面，降低评估含金量。
    """
    if not kp_ids:
        return []
    async with SessionLocal() as session:
        res = await session.execute(
            select(KpRegistry, KpCardContent)
            .outerjoin(KpCardContent, KpCardContent.kp_id == KpRegistry.id)
            .where(KpRegistry.id.in_(kp_ids))
        )
        rows = res.all()
    out: list[dict] = []
    for kp, card in rows:
        brief: dict[str, Any] = {
            "kp_id": kp.id,
            "kp_name": kp.name,
            "definition": (kp.definition or "").strip(),
            "scenario": "",
            "customer_voice": "",
            "applies_to": [],
            "rebuttals": [],
        }
        if card is not None:
            brief["scenario"] = (card.scenario or "").strip() if card.scenario else ""
            brief["customer_voice"] = (card.customer_voice or "").strip()
            brief["applies_to"] = [
                str(a).strip() for a in (card.applies_to or []) if str(a).strip()
            ]
            brief["rebuttals"] = [
                {
                    "q": str(r.get("q") or "").strip(),
                    "approach": str(r.get("approach") or "").strip(),
                }
                for r in (card.rebuttals or [])
                if isinstance(r, dict) and (r.get("q") or r.get("approach"))
            ]
        out.append(brief)
    return out


async def _load_material(scope_kp_ids: list[int], *, limit_per_kp: int = 4) -> tuple[list[dict], bool]:
    """组合素材加载：优先 chunks，全无 chunks 时降级为 KP definitions。

    返回 (items, is_chunk_based)。
    - is_chunk_based=True：items 形如 [{chunk_id, text, kp_id, kp_name}]
    - is_chunk_based=False：items 形如 [{kp_id, kp_name, definition}]，
      调用方需要意识到没有 chunk_id 可引用、ref_chunk_ids 只能为空。
    """
    chunks = await _load_chunks_by_kp(scope_kp_ids, limit_per_kp=limit_per_kp)
    if chunks:
        return chunks, True
    briefs = await _load_kp_briefs(scope_kp_ids)
    # 过滤"完全空"的 brief：definition 和富化字段都没有 → LLM 无米下锅
    # 只要任一字段有内容就保留：纯方法论 KP 可能 definition 空但 scenario/customer_voice/applies_to/rebuttals 丰富
    def _has_material(b: dict) -> bool:
        if b.get("definition") or b.get("scenario") or b.get("customer_voice"):
            return True
        if b.get("applies_to") or b.get("rebuttals"):
            return True
        return False

    briefs = [b for b in briefs if _has_material(b)]
    return briefs, False


def _build_fence(items: list[dict], nonce: str, *, is_chunk_based: bool = True) -> str:
    """把素材打包进带 nonce 的围栏，防 prompt injection。

    chunk-based: 用 chunk_id 标号。
    definition-based: 用 KP id 标号、明确写出"无原文 chunk，仅 KP 定义"。
    """
    if not items:
        return "(无素材)"
    lines: list[str] = []
    if is_chunk_based:
        for i, it in enumerate(items, start=1):
            body = sanitize_for_fence(it.get("text") or "", nonce)
            kp_tag = f" (KP {it['kp_id']}: {it.get('kp_name', '')})" if it.get("kp_id") else ""
            lines.append(f"[{i}] chunk_id={it['chunk_id']}{kp_tag}\n{body}")
    else:
        lines.append("（注意：以下仅为 KP 定义 + 富化卡片摘要，没有原文 chunk 可引用。ref_chunk_ids 必须留空。）")
        for it in items:
            kp_id = it.get("kp_id")
            kp_name = it.get("kp_name", "")
            parts: list[str] = [f"[KP {kp_id}] {kp_name}"]
            if it.get("definition"):
                parts.append(f"  · 定义：{sanitize_for_fence(it['definition'], nonce)}")
            if it.get("scenario"):
                parts.append(f"  · 应用情境：{sanitize_for_fence(it['scenario'], nonce)}")
            if it.get("customer_voice"):
                parts.append(f"  · 客户原声：{sanitize_for_fence(it['customer_voice'], nonce)}")
            applies_to = it.get("applies_to") or []
            if applies_to:
                joined = ", ".join(sanitize_for_fence(a, nonce) for a in applies_to)
                parts.append(f"  · 适用顾虑：{joined}")
            rebuttals = it.get("rebuttals") or []
            if rebuttals:
                parts.append("  · 反驳应对：")
                for r in rebuttals:
                    q = sanitize_for_fence(r.get("q", ""), nonce)
                    approach = sanitize_for_fence(r.get("approach", ""), nonce)
                    parts.append(f"    - 客户问：{q} | 应对思路：{approach}")
            lines.append("\n".join(parts))
    return "\n\n".join(lines)


async def _ainvoke_content(model: Any, prompt: str, *, timeout: int = ASSESSMENT_LLM_TIMEOUT_SEC) -> str:
    resp = await asyncio.wait_for(model.ainvoke(prompt), timeout=timeout)
    return getattr(resp, "content", "") or ""


def _oral_focus_dimension(turn_idx: int) -> str:
    return ORAL_FOCUS_DIMENSIONS[turn_idx % len(ORAL_FOCUS_DIMENSIONS)]


def _similarity(a: str, b: str) -> float:
    def grams(s: str) -> set[str]:
        compact = "".join(str(s or "").split())
        if len(compact) <= 1:
            return {compact} if compact else set()
        return {compact[i : i + 2] for i in range(len(compact) - 1)}

    ga = grams(a)
    gb = grams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


def _fallback_oral_question(*, chunks: list[dict], turn_idx: int) -> dict[str, Any]:
    if not chunks:
        return {
            "question_text": "请结合一个真实销售场景，说明你会如何介绍这个产品的核心价值。",
            "ref_kp_ids": [],
            "ref_chunk_ids": [],
            "focus_dimension": _oral_focus_dimension(turn_idx),
            "source_mode": "fallback",
            "is_fallback": True,
        }

    kp_ids = []
    for c in chunks:
        kid = c.get("kp_id")
        if isinstance(kid, int) and kid not in kp_ids:
            kp_ids.append(kid)
    kp_id = kp_ids[turn_idx % len(kp_ids)] if kp_ids else chunks[0].get("kp_id")
    kp_chunks = [c for c in chunks if c.get("kp_id") == kp_id] or chunks
    kp_name = kp_chunks[0].get("kp_name") or "这个知识点"
    templates = [
        "请用自己的话说明「{kp}」的核心价值，并举一个客户会关心的场景。",
        "如果客户质疑「{kp}」的必要性，你会先确认什么，再怎么回应？",
        "请把「{kp}」和客户的实际需求关联起来，给出一段简短介绍。",
        "客户已经听过基础介绍后，你会用哪两个证据点强化他对「{kp}」的信任？",
        "如果同事对「{kp}」理解不完整，你会提醒他避免哪些说法？",
    ]
    return {
        "question_text": templates[turn_idx % len(templates)].format(kp=kp_name),
        "ref_kp_ids": [int(kp_id)] if isinstance(kp_id, int) else [],
        "ref_chunk_ids": [int(c["chunk_id"]) for c in kp_chunks[:2] if isinstance(c.get("chunk_id"), int)],
        "focus_dimension": _oral_focus_dimension(turn_idx),
        "source_mode": "fallback",
        "is_fallback": True,
    }


# ──────────────────────────────────────────────────────
# 出题：从 scope.kp_ids → N 道题
# ──────────────────────────────────────────────────────
async def generate_bank_questions(
    *,
    scope_kp_ids: list[int],
    num: int = 5,
    difficulty: str = "normal",
) -> list[dict]:
    """返回 [{idx, text, rubric, ref_chunk_ids, ref_kp_ids}]，idx 由调用方决定。

    scope 内 KP 全无 chunks 时降级用 KP definition 作素材；definition 也空时只能放弃。
    """
    material, is_chunk_based = await _load_material(scope_kp_ids, limit_per_kp=4)
    if not material:
        _log.warning("generate_bank_questions: scope %s 既无 chunks 也无 KP definitions", scope_kp_ids)
        return []
    nonce = secrets.token_hex(4)
    fence = _build_fence(material, nonce, is_chunk_based=is_chunk_based)

    diff_hint = {
        "easy": "题目偏基础，能直接从材料找到答案",
        "normal": "题目要求理解 + 简短归纳",
        "hard": "题目需要综合多个要点或对比",
    }.get(difficulty, "题目要求理解 + 简短归纳")

    if is_chunk_based:
        ref_instruction = "  3. 每题标注它参考了哪些 chunk_id 和 kp_id（必须出现在素材里）。"
    else:
        ref_instruction = (
            "  3. 每题必须标注 ref_kp_ids（从素材中的 KP 选），ref_chunk_ids 必须留空数组 []。"
        )

    prompt = (
        "你是销售培训出题助理。基于下列【知识素材】出 "
        f"{num} 道考核题，难度风格：{diff_hint}。\n\n"
        "要求：\n"
        "  1. 每题给出题面（一句话问题，口语化，不要选择题）。\n"
        "  2. 每题列出 2-4 个评分要点（rubric），明确回答中应出现哪些核心内容。\n"
        f"{ref_instruction}\n"
        "  4. **题面必须紧扣素材中的 KP**，禁止跑题到与素材无关的销售场景。\n"
        "  5. 仅以 JSON 输出，**禁止任何解释或前后文**。\n\n"
        f"【知识素材 fence-{nonce}】\n{fence}\n【fence-{nonce} END】\n\n"
        "输出格式（严格 JSON）：\n"
        '{"questions": [{"text": "...", "rubric": ["要点1","要点2"], '
        '"ref_chunk_ids": [12,34], "ref_kp_ids": [5]}, ...]}'
    )
    model = build_chat_model(streaming=False, temperature=0.2)
    try:
        raw = await _ainvoke_content(model, prompt)
    except (asyncio.TimeoutError, Exception) as e:
        _log.warning("generate_bank_questions LLM 调用失败: %s", e)
        return []
    parsed = parse_llm_json(raw, default={}, prefer_keys=["questions"])
    items = (parsed or {}).get("questions") or []
    out: list[dict] = []
    valid_chunk_ids = {c["chunk_id"] for c in material} if is_chunk_based else set()
    valid_kp_ids = set(scope_kp_ids)
    for it in items[:num]:
        text = (it.get("text") or "").strip()
        if not text:
            continue
        rubric = [str(x).strip() for x in (it.get("rubric") or []) if str(x).strip()]
        ref_chunk_ids = [
            int(x) for x in (it.get("ref_chunk_ids") or [])
            if isinstance(x, (int, str)) and str(x).isdigit() and int(x) in valid_chunk_ids
        ] if is_chunk_based else []
        ref_kp_ids = [
            int(x) for x in (it.get("ref_kp_ids") or [])
            if isinstance(x, (int, str)) and str(x).isdigit() and int(x) in valid_kp_ids
        ]
        # 强制兜底：若 LLM 没填 ref_kp_ids，从 scope 里轮转分配一个，保证可追溯
        if not ref_kp_ids and scope_kp_ids:
            ref_kp_ids = [scope_kp_ids[len(out) % len(scope_kp_ids)]]
        out.append(
            {
                "text": text,
                "rubric": rubric,
                "ref_chunk_ids": ref_chunk_ids,
                "ref_kp_ids": ref_kp_ids,
            }
        )
    return out


# ──────────────────────────────────────────────────────
# 单 KP 一题：学习闭环用。Admin 端预生成后写入 kp_card_content.exam_*
# ──────────────────────────────────────────────────────
async def generate_single_question_for_kp(
    kp_id: int,
    *,
    difficulty: str = "normal",
) -> dict[str, Any]:
    """为单个 KP 生成一道考核题。

    返回 {question, rubric, ref_chunk_ids, ref_kp_ids}；
    若素材不足/LLM 失败，返回 {} （调用方据此把 exam_status 设为 error）。
    """
    items = await generate_bank_questions(scope_kp_ids=[kp_id], num=1, difficulty=difficulty)
    if not items:
        return {}
    q = items[0]
    return {
        "question": q.get("text", ""),
        "rubric": list(q.get("rubric") or []),
        "ref_chunk_ids": list(q.get("ref_chunk_ids") or []),
        "ref_kp_ids": list(q.get("ref_kp_ids") or [kp_id]),
    }


# ──────────────────────────────────────────────────────
# Bank 模式评分
# ──────────────────────────────────────────────────────
async def score_bank_answer(
    *,
    question_text: str,
    rubric: list[str],
    ref_chunk_ids: list[int],
    ref_kp_ids: list[int],
    learner_answer: str,
) -> dict[str, Any]:
    """单题评分。返回 {score, rubric_breakdown, citations, kp_tags, missing_points, comment}。"""
    answer = sanitize_untrusted(learner_answer, max_len=2000)
    chunks = await _load_chunks_by_id(ref_chunk_ids)
    nonce = secrets.token_hex(4)
    fence = _build_fence(chunks, nonce) if chunks else "(无参考材料)"

    rubric_lines = "\n".join(f"  - {r}" for r in rubric) if rubric else "  - （无明确要点，自由打分）"

    prompt = (
        "你是销售培训考官，按要点对学员答案打分。\n\n"
        f"【题目】{sanitize_untrusted(question_text, max_len=500)}\n\n"
        "【评分要点】\n"
        f"{rubric_lines}\n\n"
        f"【参考材料 fence-{nonce}】\n{fence}\n【fence-{nonce} END】\n\n"
        f"【学员答案】\n{answer}\n\n"
        "规则：\n"
        "  1. 对每个要点判定 hit | partial | miss，并给一句简短理由。\n"
        "  2. 总分 = 命中要点数加权（hit=1.0, partial=0.5, miss=0），归一到 0-100。\n"
        "  3. 如果没有要点，按答案是否切题 + 是否准确，整体打 0-100。\n"
        "  4. 仅输出 JSON。\n\n"
        "格式：\n"
        '{"score": 75, "rubric_breakdown": [{"point":"...","status":"hit|partial|miss","note":"..."}], '
        '"missing_points": ["..."], "comment": "整体点评 1-2 句"}'
    )
    model = build_chat_model(streaming=False, temperature=0.0)
    try:
        raw = await _ainvoke_content(model, prompt)
    except (asyncio.TimeoutError, Exception) as e:
        _log.warning("score_bank_answer LLM 调用失败: %s", e)
        return {
            "score": 0.0,
            "rubric_breakdown": [],
            "citations": ref_chunk_ids,
            "kp_tags": ref_kp_ids,
            "missing_points": [],
            "comment": f"评分失败：{e}",
            "error": True,
        }
    parsed = parse_llm_json(
        raw, default={}, prefer_keys=["score", "rubric_breakdown"]
    ) or {}
    try:
        score = float(parsed.get("score") or 0.0)
    except (TypeError, ValueError):
        score = 0.0
    score = max(0.0, min(100.0, score))
    return {
        "score": score,
        "rubric_breakdown": parsed.get("rubric_breakdown") or [],
        "citations": ref_chunk_ids,
        "kp_tags": ref_kp_ids,
        "missing_points": parsed.get("missing_points") or [],
        "comment": parsed.get("comment") or "",
    }


# ──────────────────────────────────────────────────────
# AI 主考（oral）出下一题
# ──────────────────────────────────────────────────────
async def oral_next_question(
    *,
    scope_kp_ids: list[int],
    asked_kp_ids: list[int],
    history: list[dict],
    turn_idx: int,
) -> dict[str, Any]:
    """返回 {question_text, ref_kp_ids, ref_chunk_ids}。history 形如 [{q,a,score}]。

    scope 内 KP 全无 chunks 时降级用 KP definition 作素材。
    """
    focus = _oral_focus_dimension(turn_idx)
    remaining = [k for k in scope_kp_ids if k not in asked_kp_ids] or scope_kp_ids
    material, is_chunk_based = await _load_material(remaining[:4], limit_per_kp=3)
    source_mode = "chunk" if is_chunk_based else ("kp_definition" if material else "fallback")
    if not material:
        return _fallback_oral_question(chunks=[], turn_idx=turn_idx)
    nonce = secrets.token_hex(4)
    fence = _build_fence(material, nonce, is_chunk_based=is_chunk_based)
    # 兼容旧引用：chunks 仅在 chunk-based 路径下有意义
    chunks = material if is_chunk_based else []

    history_text = ""
    for i, t in enumerate(history[-3:], start=1):
        q = sanitize_untrusted(t.get("q"), max_len=200)
        a = sanitize_untrusted(t.get("a"), max_len=400)
        history_text += f"\nQ{i}: {q}\nA{i}: {a}\n"

    previous_questions = [
        sanitize_untrusted(t.get("q"), max_len=200) for t in history if (t.get("q") or "").strip()
    ]
    previous_lines = "\n".join(f"- {q}" for q in previous_questions[-8:]) or "- （无）"

    ref_instruction = (
        "  4. 标注本题考察的 kp_id 和 chunk_id（必须在素材里）。"
        if is_chunk_based
        else "  4. 必须标注 ref_kp_ids（从素材中的 KP 选），ref_chunk_ids 留空数组 []。"
    )
    prompt = (
        f"你是销售培训面试官，正在对学员做口试。这是第 {turn_idx + 1} 道题。\n"
        f"本轮只考察这个能力维度：{focus}。\n"
        "请基于【素材】出一道新题，要求：\n"
        "  1. **题面必须紧扣素材中的 KP**，禁止跑题到与素材无关的话题。\n"
        "  2. 必须换一个考察角度，禁止连续追问同一个缺陷或同一句话的变体。\n"
        "  3. 如果上一轮问的是诊断/判断，本轮就问介绍/解释/应对；如果上一轮问的是应对，本轮就问证据/边界/流程。\n"
        f"{ref_instruction}\n"
        "  5. 题面口语化，一句话问题，不要复述历史题面。\n"
        "  6. 仅输出 JSON，禁止 markdown 和解释。\n\n"
        f"【素材 fence-{nonce}】\n{fence}\n【fence-{nonce} END】\n"
        f"【最近问答历史】{history_text or '(无)'}\n\n"
        f"【绝对不要重复这些题面】\n{previous_lines}\n\n"
        '{"question": "...", "ref_kp_ids": [12], "ref_chunk_ids": [34, 56]}'
    )
    model = build_chat_model(streaming=False, temperature=0.3)

    def _fallback_with_scope() -> dict[str, Any]:
        fb = _fallback_oral_question(chunks=chunks, turn_idx=turn_idx)
        # definition-based 或素材完全为空时，确保至少有一个 ref_kp_id 回流，避免 stats/by_kp 空
        if not fb["ref_kp_ids"]:
            pool = remaining or scope_kp_ids
            if pool:
                fb["ref_kp_ids"] = [pool[turn_idx % len(pool)]]
        # 如果 material 是 definition-based，给一个更贴近 KP 名的题面
        if not is_chunk_based and material:
            kp = material[turn_idx % len(material)]
            fb["question_text"] = f"请用自己的话讲清楚「{kp.get('kp_name','这个知识点')}」的核心要点，并举一个客户会关心的场景。"
        fb["focus_dimension"] = focus
        fb["source_mode"] = "fallback"
        fb["is_fallback"] = True
        return fb

    try:
        raw = await _ainvoke_content(model, prompt)
    except (asyncio.TimeoutError, Exception) as e:
        _log.warning("oral_next_question LLM 调用失败: %s", e)
        return _fallback_with_scope()
    parsed = parse_llm_json(raw, default={}, prefer_keys=["question", "ref_kp_ids"]) or {}
    valid_chunk_ids = {c["chunk_id"] for c in chunks}
    valid_kp_ids = set(scope_kp_ids)
    question = (parsed.get("question") or "").strip()
    if not question:
        return _fallback_with_scope()
    if any(_similarity(question, old) >= 0.58 for old in previous_questions):
        _log.info("oral_next_question discarded repetitive question: %s", question)
        return _fallback_with_scope()

    ref_kp_ids = [
        int(x) for x in (parsed.get("ref_kp_ids") or [])
        if isinstance(x, (int, str)) and str(x).isdigit() and int(x) in valid_kp_ids
    ]
    ref_chunk_ids = [
        int(x) for x in (parsed.get("ref_chunk_ids") or [])
        if isinstance(x, (int, str)) and str(x).isdigit() and int(x) in valid_chunk_ids
    ] if is_chunk_based else []
    # ref_kp_ids 兜底（即便 definition-based 也保证回流）：从 remaining 里轮转挑一个
    if not ref_kp_ids:
        pool = remaining or scope_kp_ids
        if pool:
            ref_kp_ids = [pool[turn_idx % len(pool)]]
    if is_chunk_based and not ref_chunk_ids:
        fallback = _fallback_oral_question(chunks=chunks, turn_idx=turn_idx)
        ref_chunk_ids = fallback["ref_chunk_ids"]
    return {
        "question_text": question,
        "ref_kp_ids": ref_kp_ids,
        "ref_chunk_ids": ref_chunk_ids,
        "focus_dimension": focus,
        "source_mode": source_mode,
        "is_fallback": False,
    }


# ──────────────────────────────────────────────────────
# Oral 综合评价（最后一轮后调）
# ──────────────────────────────────────────────────────
async def oral_final_evaluate(turns: list[dict]) -> dict[str, Any]:
    """turns: [{q, a, score, kp_ids}]. 返回 {summary, strengths, weaknesses, review_kp_ids, error?}."""
    if not turns:
        return {"summary": "", "strengths": [], "weaknesses": [], "review_kp_ids": []}

    body_lines: list[str] = []
    all_kp_ids: list[int] = []
    for i, t in enumerate(turns, start=1):
        q = sanitize_untrusted(t.get("q"), max_len=200)
        a = sanitize_untrusted(t.get("a"), max_len=600)
        s = t.get("score")
        kp_ids = t.get("kp_ids") or []
        kp_tag = f" KP={kp_ids}" if kp_ids else ""
        body_lines.append(f"#{i} [{s} 分]{kp_tag} Q: {q}\n  A: {a}")
        for kid in kp_ids:
            try:
                k = int(kid)
                if k not in all_kp_ids:
                    all_kp_ids.append(k)
            except (TypeError, ValueError):
                pass
    body = "\n".join(body_lines)

    # 找最弱的一轮的 KP 作为 review 兜底
    worst_kp_ids: list[int] = []
    if turns:
        worst = min(turns, key=lambda x: (x.get("score") if x.get("score") is not None else 100))
        worst_kp_ids = [int(k) for k in (worst.get("kp_ids") or []) if isinstance(k, (int, str)) and str(k).isdigit()]

    prompt = (
        "你是销售培训督导，下面是学员一场 AI 主考的全部问答（每轮包含考察的 KP id）。请给出综合评价。\n\n"
        f"{body}\n\n"
        "规则：\n"
        "  1. summary 1-2 句白描表现。\n"
        "  2. strengths 至少 1 条，weaknesses 至少 1 条（即便表现优异也要写一个可继续提升的方向）。\n"
        "  3. review_kp_ids **必须**至少填 1 个：从上述问答的 KP id 中挑「最薄弱 / 最值得复习」的（哪怕学员整体表现良好）。\n"
        "  4. 仅输出 JSON，禁止前后文。\n\n"
        '{"summary": "1-2 句总体表现", "strengths": ["..."], "weaknesses": ["..."], '
        '"review_kp_ids": [12]}'
    )
    model = build_chat_model(streaming=False, temperature=0.2)
    raw_err: str = ""
    try:
        raw = await _ainvoke_content(model, prompt)
    except asyncio.TimeoutError:
        raw_err = "LLM 调用超时"
        _log.warning("oral_final_evaluate LLM timeout (turns=%d)", len(turns))
    except Exception as e:  # 包含 OpenAI/Anthropic 客户端的各类异常
        raw_err = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        _log.warning("oral_final_evaluate LLM 调用失败 [%s]: %s", type(e).__name__, e)

    if raw_err:
        return {
            "summary": f"综合评价生成失败（{raw_err}）。请联系管理员或刷新重试。",
            "strengths": [],
            "weaknesses": [],
            "review_kp_ids": worst_kp_ids,
            "error": raw_err,
        }

    parsed = parse_llm_json(raw, default={}, prefer_keys=["summary", "strengths"]) or {}
    review_ids = [
        int(x) for x in (parsed.get("review_kp_ids") or [])
        if isinstance(x, (int, str)) and str(x).isdigit()
    ]
    # 兜底：LLM 没填或全是无效 id 时，回退到最弱轮的 KP，再回退到全部 KP 第一个
    if not review_ids:
        review_ids = worst_kp_ids or (all_kp_ids[:1] if all_kp_ids else [])
    return {
        "summary": parsed.get("summary") or "",
        "strengths": parsed.get("strengths") or [],
        "weaknesses": parsed.get("weaknesses") or [],
        "review_kp_ids": review_ids,
    }
