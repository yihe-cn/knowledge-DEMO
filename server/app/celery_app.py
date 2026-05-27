"""Celery 任务定义。

队列设计（MVP 不分队列，单 default 即可）：
- ingest_document_task：入库一个文档
- extract_kps_task：对一个 doc 跑 KP 抽取
"""
from __future__ import annotations

from celery import Celery

from .config import settings


celery_app = Celery(
    "simugo",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=False,
    task_track_started=True,
)


@celery_app.task(name="simugo.ingest_document")
def ingest_document_task(file_path: str, product_id: int | None = None) -> int:
    from .ingestion.pipeline import ingest_document_sync

    return ingest_document_sync(file_path, product_id=product_id)


@celery_app.task(name="simugo.extract_kps")
def extract_kps_task(doc_id: int) -> dict:
    from .kp_extraction.extractor import extract_kps_sync

    return extract_kps_sync(doc_id)


@celery_app.task(bind=True, name="simugo.reindex_kps_batch")
def reindex_kps_batch_task(self, kp_ids: list[int] | None = None, reenrich: bool = False) -> dict:
    """批量回填 KP 召回索引。kp_ids=None 时默认所有 status=approved KP；
    reenrich=True 时每个 KP 先调 LLM 重新生成 trigger_questions/aliases/scenario 再 reindex。"""
    from .kp_extraction.kp_indexer import reindex_kps_batch_sync

    def _progress(meta: dict) -> None:
        self.update_state(state="PROGRESS", meta=meta)

    return reindex_kps_batch_sync(kp_ids, reenrich=reenrich, progress_callback=_progress)
