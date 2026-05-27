"""KP 检索索引：把 KP 的名称 + 定义 + 富化字段拼成长文本，embed 进 Milvus kp_embeddings。

设计意图：解决"方法论命名 KP" vs "学员业务场景化 query"的语义鸿沟。
学员问"客户问我们和特斯拉的区别该怎么答"应能命中"竞品对比问诊法"这种方法论 KP。

触发点：
- enrich 成功后（enricher.py）
- /kp/{id}/approve、merge、delete、card-update（routes/kp.py）
- 批量回填任务（celery_app.reindex_kps_batch_task）
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Callable

from sqlalchemy import select

from ..db import KpCardContent, KpRegistry, KpStatus, RetrievalIndexStatus, SyncSessionLocal
from ..embeddings import embed_sync
from ..vector_store import delete_kp_embedding, upsert_kp_embedding


def _content_hash(text: str, status_flag: int) -> str:
    """索引内容指纹：覆盖文本 + status flag。
    并发场景下，如果一个慢任务的 hash 与"当前 card 已写入的 hash"不同，说明已经被另一个新任务覆盖过，旧任务应放弃。
    把 status_flag 算进去是为了让 approve/archive 切换也算"内容变化"，避免被旧 draft 任务覆盖回 status=0。"""
    h = hashlib.sha256()
    h.update(f"s={status_flag}\n".encode("utf-8"))
    h.update(text.encode("utf-8"))
    return h.hexdigest()


def build_kp_index_text(kp: KpRegistry, card: KpCardContent | None) -> str:
    """把 KP 各字段按"召回权重直觉顺序"拼成长文本。空字段直接跳过段落。

    顺序：名称 → 定义 → 应用情境 → 典型问题 → 关键词 → 客户原声 → 适用顾虑 → 销售话术。
    """
    parts: list[str] = []
    name = (kp.name or "").strip()
    if name:
        parts.append(f"[名称] {name}")
    definition = (kp.definition or "").strip()
    if definition:
        parts.append(f"[定义] {definition}")

    if card is not None:
        scenario = (card.scenario or "").strip() if card.scenario else ""
        if scenario:
            parts.append(f"[应用情境] {scenario}")

        triggers = [str(q).strip() for q in (card.trigger_questions or []) if str(q).strip()]
        if triggers:
            parts.append("[典型问题]\n" + "\n".join(f"- {q}" for q in triggers))

        aliases = [str(a).strip() for a in (card.aliases or []) if str(a).strip()]
        if aliases:
            parts.append(f"[关键词] {', '.join(aliases)}")

        customer_voice = (card.customer_voice or "").strip()
        if customer_voice:
            parts.append(f"[客户原声] {customer_voice}")

        applies_to = [str(a).strip() for a in (card.applies_to or []) if str(a).strip()]
        if applies_to:
            parts.append(f"[适用顾虑] {', '.join(applies_to)}")

        sales = (card.sales or "").strip()
        if sales:
            parts.append(f"[销售话术] {sales}")

    return "\n\n".join(parts)


def _write_index_failure(kp_id: int, error: str) -> None:
    """把 reindex 失败状态写到 card；自己开 session 防止主 session 被脏。"""
    try:
        with SyncSessionLocal() as s:
            card = s.execute(
                select(KpCardContent).where(KpCardContent.kp_id == kp_id)
            ).scalar_one_or_none()
            if card is None:
                card = KpCardContent(
                    kp_id=kp_id,
                    retrieval_index_status=RetrievalIndexStatus.failed,
                    retrieval_index_error=error[:1000],
                )
                s.add(card)
            else:
                card.retrieval_index_status = RetrievalIndexStatus.failed
                card.retrieval_index_error = error[:1000]
            s.commit()
    except Exception:  # noqa: BLE001
        # 状态都写不进去也只能放弃；调用方通过返回值也能看到 error
        pass


def reindex_kp_sync(kp_id: int) -> dict:
    """读 KP + Card → 算 content_hash → embed → upsert Milvus → 比对 hash 后回写状态。

    并发防覆盖：在 upsert 前后都计算"当前应有的 hash"；写回 DB 时如果发现 card.retrieval_content_hash
    已经被另一个新任务改成了不同值（说明在我 embed 期间内容被改过且被另一路完成），就放弃回写但不算失败
    —— Milvus 里此时是最新任务的向量（upsert 顺序由谁慢谁后定），状态字段保持新任务写入的。

    返回 {ok, kp_id, error?, skipped?}；不抛异常。
    """
    with SyncSessionLocal() as session:
        kp = session.get(KpRegistry, kp_id)
        if not kp:
            return {"ok": False, "kp_id": kp_id, "error": "kp not found"}

        card = session.execute(
            select(KpCardContent).where(KpCardContent.kp_id == kp_id)
        ).scalar_one_or_none()

        text = build_kp_index_text(kp, card)
        if not text.strip():
            err = "empty index text"
            _write_index_failure(kp_id, err)
            return {"ok": False, "kp_id": kp_id, "error": err}

        status_flag = 1 if kp.status == KpStatus.approved else 0
        my_hash = _content_hash(text, status_flag)

        try:
            vecs = embed_sync([text])
            if not vecs:
                err = "embedding returned empty"
                _write_index_failure(kp_id, err)
                return {"ok": False, "kp_id": kp_id, "error": err}
            upsert_kp_embedding(kp_id, status_flag, vecs[0])
        except Exception as e:  # noqa: BLE001
            err = repr(e)[:500]
            _write_index_failure(kp_id, err)
            return {"ok": False, "kp_id": kp_id, "error": err}

        # 回写状态：重新拉一次最新 card 做并发覆盖检查
        # 如果 DB 里的 hash 与我准备写入的 hash 相同，说明已经有别的任务写完同样内容了，等价 noop；
        # 如果不同但 retrieval_indexed_at 比我新（晚于本任务开始），说明另一路 reindex 在我 embed 期间完成了
        # —— Milvus 已经被我 upsert 覆盖成 my_hash 对应的向量，但 DB 状态保持那个更新的内容反而误导。
        # 决策：以 timestamp 比较为准。只要本任务计算时间晚于 card 上记录的，就允许覆盖。
        now = datetime.utcnow()
        fresh_card = session.execute(
            select(KpCardContent).where(KpCardContent.kp_id == kp_id)
        ).scalar_one_or_none()
        if fresh_card is None:
            fresh_card = KpCardContent(kp_id=kp_id)
            session.add(fresh_card)
            session.flush()

        # 真正的"防覆盖"判定：如果当前 DB 上的 hash 不同 且 它的 indexed_at 比我现在更新，
        # 说明有更晚的任务已经写完——放弃本次的状态回写（但向量已 upsert，无可挽回；
        # 后到的任务会再做一次自己的 upsert + 状态回写，所以最终一致由"最晚任务"决定）
        existing_indexed_at = fresh_card.retrieval_indexed_at
        if (
            fresh_card.retrieval_content_hash
            and fresh_card.retrieval_content_hash != my_hash
            and existing_indexed_at is not None
            and existing_indexed_at >= now
        ):
            session.rollback()
            return {
                "ok": True,
                "kp_id": kp_id,
                "skipped": "newer reindex already wrote state",
            }

        fresh_card.retrieval_indexed_at = now
        fresh_card.retrieval_content_hash = my_hash
        fresh_card.retrieval_index_status = RetrievalIndexStatus.done
        fresh_card.retrieval_index_error = None
        session.commit()
        return {"ok": True, "kp_id": kp_id}


def reindex_kps_batch_sync(
    kp_ids: list[int] | None = None,
    reenrich: bool = False,
    progress_callback: Callable[[dict], None] | None = None,
) -> dict:
    """批量重建 KP 索引。

    kp_ids=None 时默认遍历所有 status=approved KP。
    reenrich=True 时每个 KP 先走一遍 enrich_kp_sync（重新生成 trigger_questions 等），再 reindex。
    单 KP 失败不中断批次。
    """
    if kp_ids is None:
        with SyncSessionLocal() as session:
            rows = session.execute(
                select(KpRegistry.id).where(KpRegistry.status == KpStatus.approved)
            ).all()
            target_ids = [int(r[0]) for r in rows]
    else:
        target_ids = list(dict.fromkeys(int(k) for k in kp_ids))

    total_steps = len(target_ids) * (2 if reenrich else 1)

    def _emit_progress(
        current: int,
        *,
        stage: str,
        kp_id: int | None = None,
        ok_count: int = 0,
        fail_count: int = 0,
    ) -> None:
        if progress_callback is None:
            return
        progress_callback({
            "current": current,
            "total": total_steps,
            "stage": stage,
            "kp_id": kp_id,
            "ok_count": ok_count,
            "fail_count": fail_count,
        })

    if not target_ids:
        return {"ok": True, "ok_count": 0, "fail_count": 0, "failures": [], "total": 0, "total_steps": 0}

    if reenrich:
        # 局部导入避免循环：enricher 也会 import kp_indexer
        from .enricher import enrich_kp_sync

    failures: list[dict] = []
    ok_count = 0
    current = 0
    _emit_progress(current, stage="queued")
    for kid in target_ids:
        try:
            if reenrich:
                _emit_progress(current, stage="enriching", kp_id=kid, ok_count=ok_count, fail_count=len(failures))
                r = enrich_kp_sync(kid)
                current += 1
                if not r.get("ok"):
                    failures.append({"kp_id": kid, "stage": "enrich", "error": r.get("error") or "enrich failed"})
                    _emit_progress(
                        current,
                        stage="enrich_failed",
                        kp_id=kid,
                        ok_count=ok_count,
                        fail_count=len(failures),
                    )
                    continue
                _emit_progress(current, stage="enriched", kp_id=kid, ok_count=ok_count, fail_count=len(failures))
            _emit_progress(current, stage="reindexing", kp_id=kid, ok_count=ok_count, fail_count=len(failures))
            r = reindex_kp_sync(kid)
            current += 1
            if r.get("ok"):
                ok_count += 1
                _emit_progress(current, stage="indexed", kp_id=kid, ok_count=ok_count, fail_count=len(failures))
            else:
                failures.append({"kp_id": kid, "stage": "reindex", "error": r.get("error") or "reindex failed"})
                _emit_progress(
                    current,
                    stage="index_failed",
                    kp_id=kid,
                    ok_count=ok_count,
                    fail_count=len(failures),
                )
        except Exception as e:  # noqa: BLE001
            failures.append({"kp_id": kid, "stage": "exception", "error": repr(e)[:500]})
            current += 1
            current = min(current, total_steps)
            _emit_progress(current, stage="exception", kp_id=kid, ok_count=ok_count, fail_count=len(failures))

    return {
        "ok": not failures,
        "ok_count": ok_count,
        "fail_count": len(failures),
        "failures": failures,
        "total": len(target_ids),
        "total_steps": total_steps,
    }


def delete_kp_index(kp_id: int) -> dict:
    """KP 被硬删除时清理 Milvus 行。失败也吞掉错误，DB 已是真相。"""
    try:
        delete_kp_embedding(kp_id)
        return {"ok": True, "kp_id": kp_id}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "kp_id": kp_id, "error": repr(e)[:500]}
