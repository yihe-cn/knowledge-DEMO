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
