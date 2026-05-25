#!/usr/bin/env bash
# Celery worker 启动脚本
set -e
cd "$(dirname "$0")/.."
exec uv run celery -A app.celery_app.celery_app worker --loglevel=info --concurrency=2
