"""CLI：手动入库 / 重跑 KP 抽取。

用法：
    uv run python -m app.ingestion.cli ingest "Knowledge/PAX 内训/xxx.pptx"
    uv run python -m app.ingestion.cli extract <doc_id>
    uv run python -m app.ingestion.cli ls
"""
from __future__ import annotations

import typer
from sqlalchemy import select

from ..db import KbDocument, SyncSessionLocal


app = typer.Typer(help="SIMUGO KB ingestion CLI")


@app.command()
def ingest(
    file: str = typer.Argument(..., help="文档路径"),
    sync: bool = typer.Option(True, "--sync/--async", help="直接跑还是丢到 Celery 队列"),
) -> None:
    if sync:
        from .pipeline import ingest_document_sync
        doc_id = ingest_document_sync(file, trigger_kp_extraction=False)
        typer.echo(f"ingested doc_id={doc_id}")
    else:
        from ..celery_app import ingest_document_task
        r = ingest_document_task.delay(file)
        typer.echo(f"task id={r.id}")


@app.command()
def extract(doc_id: int) -> None:
    from ..kp_extraction.extractor import extract_kps_sync
    res = extract_kps_sync(doc_id)
    typer.echo(res)


@app.command()
def ls() -> None:
    with SyncSessionLocal() as session:
        rows = session.execute(select(KbDocument).order_by(KbDocument.id.desc()).limit(50)).scalars().all()
        for r in rows:
            typer.echo(f"#{r.id} [{r.status}] chunks={r.chunk_count}  {r.file_name}")


if __name__ == "__main__":
    app()
