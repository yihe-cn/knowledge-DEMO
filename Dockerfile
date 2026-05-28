# syntax=docker/dockerfile:1.6
# SIMUGO demo 镜像：FastAPI 单进程 + 前端静态资源 + Milvus Lite + SQLite。
# 构建：docker build --platform linux/amd64 -t simugo-demo:latest .
# 运行：docker run --platform linux/amd64 -p 8000:8000 -v simugo_data:/data simugo-demo:latest

# ─────────────────────────────── Stage 1a: 学员端前端 ───────────────────────────
FROM node:20-slim AS frontend
WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/ ./
RUN npm run build
# 产物在 /build/dist


# ─────────────────────────────── Stage 1b: 管理后台前端 ─────────────────────────
FROM node:20-slim AS admin
WORKDIR /build

COPY admin/package.json admin/package-lock.json ./
RUN npm ci

COPY admin/ ./
RUN npm run build
# 产物在 /build/dist（base=/admin/ 已经在 vite.config 里设好）


# ─────────────────────────────── Stage 2: 运行时镜像 ────────────────────────────
FROM python:3.11-slim AS runtime

# Milvus Lite 在 Linux 上依赖 glibc + libstdc++（slim 已带，但保险显式装）
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgomp1 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # 数据落地目录，建议挂卷
    MILVUS_DB_PATH=/data/milvus.db \
    MYSQL_DSN=sqlite+aiosqlite:////data/app.db \
    MYSQL_DSN_SYNC=sqlite:////data/app.db \
    FRONTEND_DIST=/app/frontend \
    # 用户上传文件目录（封面、KB 原始件）也放到持久卷，避免容器重建丢图
    UPLOADS_DIR=/data/uploads \
    ALLOW_ORIGINS=http://localhost:8000

WORKDIR /app

# 先装依赖以最大化缓存命中
COPY server/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# 后端源码
COPY server/app ./app
COPY server/alembic.ini ./alembic.ini
COPY server/migrations ./migrations

# 前端构建产物
COPY --from=frontend /build/dist ./frontend
# 管理后台构建产物（挂在 /admin/ 子路径下）
COPY --from=admin /build/dist ./admin

# 初始种子数据（由 server/scripts/export_seed.py 从生产 MySQL+Milvus dump 出来）
# 容器首次启动时 entrypoint 会把 /seed/ 拷到 /data/。
# 注意：seed/ 不存在也不阻塞 build（COPY 空目录就行；CI 上可以选择不带 seed）
COPY server/seed /seed
# 产品封面图（KB 原始件 pdf/pptx 太大不入镜像，需要的话从 admin 再上传一遍）
COPY server/uploads/products /seed/uploads/products

# 启动脚本：负责种子注入 + exec CMD
COPY server/scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 数据卷
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
# 单进程 uvicorn，前端走 StaticFiles 由 FastAPI 同进程托管
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
