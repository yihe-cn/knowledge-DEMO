# SIMUGO Demo 镜像

把整个 SIMUGO 学员端（FastAPI + React + Milvus Lite + SQLite）打成一个单进程
Docker 镜像，适合本地 demo / 离线分发。

## 架构

```
┌─────────────────────────────────────────────────┐
│ python:3.11-slim                                │
│  ┌───────────────────────────────────────────┐  │
│  │ uvicorn (单进程)                           │  │
│  │   ├─ /api/*    → FastAPI 路由             │  │
│  │   └─ /        → StaticFiles(app/dist)     │  │
│  └───────────────────────────────────────────┘  │
│  ┌─────────────────────┐ ┌────────────────────┐ │
│  │ SQLite (/data/app.db)│ │ Milvus Lite        │ │
│  │                     │ │ (/data/milvus.db)  │ │
│  └─────────────────────┘ └────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- 无 etcd / MinIO / 独立 Milvus / Redis / MySQL 外部依赖
- Celery 已禁用（admin_kb 上传走 inline ingestion 回退分支）
- 数据全部落 `/data`，通过 volume 持久化

## 与生产环境的差异

| 组件     | 生产                       | Demo 镜像                          |
| -------- | -------------------------- | ---------------------------------- |
| 关系库   | MySQL 8                    | SQLite (`/data/app.db`)            |
| 向量库   | Milvus standalone (gRPC)   | Milvus Lite (`/data/milvus.db`)    |
| 向量索引 | HNSW                       | FLAT（Lite 不支持 HNSW，几万条 FLAT 也够）|
| 异步任务 | Celery + Redis             | 关闭，路由内 inline 执行            |
| 前端     | 独立部署                   | FastAPI 同进程 StaticFiles 托管     |

## 构建

> Milvus Lite 只发布 Linux/macOS 平台的 wheel。在 Apple Silicon 上构建 Linux
> 镜像务必显式指定 `--platform`，避免拉到 arm64 镜像跑到 amd64 机器上、或反过来。

```bash
# 在 Mac (arm64) 上为 Linux x86_64 服务器构建：
docker build --platform linux/amd64 -t simugo-demo:latest .

# 在 Mac 上本地跑（Apple Silicon）：
docker build --platform linux/arm64 -t simugo-demo:arm64 .
```

需要的环境变量在 `Dockerfile` 里都给了默认值；如要覆盖 LLM key 等，run 时传：

```bash
docker run -d --name simugo-demo \
  --platform linux/amd64 \
  -p 8000:8000 \
  -v simugo_data:/data \
  -e OPENAI_API_KEY=sk-xxx \
  -e EMBEDDING_API_KEY=sf-xxx \
  -e INTERNAL_TOKEN=demo-token \
  simugo-demo:latest
```

打开 http://localhost:8000 即为学员端；`http://localhost:8000/healthz` 看健康检查。

## 数据持久化

- `/data/app.db` — SQLite 业务数据
- `/data/milvus.db` — 向量库
- 建议挂 named volume：`-v simugo_data:/data`

首次启动 FastAPI 会自动 `create_all()` 建表，无需手动跑 alembic。

## 离线分发

构建后导出 tar，发到目标机器再 load：

```bash
# 1) 在有网络的机器上构建并导出（注意目标机器的架构！）
docker build --platform linux/amd64 -t simugo-demo:latest .
docker save simugo-demo:latest | gzip > simugo-demo.tar.gz

# 2) 拷到目标机器（U 盘 / scp / 内网）
scp simugo-demo.tar.gz user@target:/tmp/

# 3) 目标机器上 load 并运行
gunzip -c simugo-demo.tar.gz | docker load
docker run -d --name simugo-demo \
  -p 8000:8000 \
  -v simugo_data:/data \
  --restart unless-stopped \
  simugo-demo:latest
```

## 常用排查

```bash
# 看实时日志
docker logs -f simugo-demo

# 进容器看 /data
docker exec -it simugo-demo ls -la /data

# 健康检查（依赖连通性）
curl http://localhost:8000/healthz
curl http://localhost:8000/healthz/rag    # Redis 会显示 err 属正常（demo 不用）

# 重置数据（删卷）
docker rm -f simugo-demo
docker volume rm simugo_data
```

## 已知限制

1. **向量索引只能 FLAT**：Milvus Lite 不支持 HNSW / IVF。几万条规模无影响。
2. **`array_contains` on ARRAY field**：KP 过滤检索依赖此特性，Milvus Lite 支持
   但历史上偶有 bug，如发现 KP 过滤返回异常，先关闭 KP 过滤再排查。
3. **Celery 禁用**：admin 端上传文档会走 inline 回退分支（同步阻塞请求至 ingestion
   完成），单次大文件上传会比较慢；demo 场景可接受。
4. **生成列**：原 MySQL 迁移 `0004_practice_role` 里有 `default_product_id` 生成
   列 + 唯一索引，SQLite 路径用 `Base.metadata.create_all()` 不会建该约束，
   demo 中 PracticeRole 默认值靠应用层保证。
