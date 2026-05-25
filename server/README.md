# SIMUGO Server

FastAPI + LangGraph 后端，承载三类 AI 调用（AIQA / Practice / Quiz），全部走 SSE 流式。
AIQA 已升级为 Agentic RAG（Planner → Retriever → Reranker → Synthesizer → Verifier）。

## 启动（仅 LLM 链路）

```bash
cd server
cp .env.example .env       # 填入 OPENAI_API_KEY 等
uv sync                    # 或 pip install -e .
uv run uvicorn app.main:app --reload --port 8000
```

## 启动 RAG 栈（Milvus / MySQL / Redis）

```bash
cd server
# 1) 起中间件
docker compose up -d
# 2) 等 MySQL/Milvus 健康（首次约 90s）
docker compose ps
# 3) 建表
uv run alembic upgrade head
# 4) 起 Celery worker（开新终端）
./scripts/worker.sh
# 5) 验证 RAG 健康
curl http://localhost:8000/healthz/rag
```

`.env` 需要补：
- `EMBEDDING_API_KEY` — BGE-M3 兼容接口（默认硅基流动 `https://api.siliconflow.cn/v1`）
- 数据库/Milvus URI 默认匹配 docker-compose，不用改

## 入库一份文档 + 抽 KP

```bash
# 同步入库（最直接，跑完直接得到 doc_id）
uv run python -m app.ingestion.cli ingest "../Knowledge/PAX 内训/修改脚本-【美化】PAX内训2.5h-肠道微生态与人体健康.pptx"
uv run python -m app.ingestion.cli ls

# 跑 KP 抽取（同步）
uv run python -m app.ingestion.cli extract <doc_id>

# 审批 KP（人工 review 后）
curl http://localhost:8000/api/kp?status=draft
curl -X POST http://localhost:8000/api/kp/<kp_id>/approve
```

approve 时会回写 Milvus 的 `kb_chunks.kp_ids`，让 Retriever 后续可按 KP 过滤。

## 路由

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/qa` | AIQA Agentic RAG 单轮问答（流式 token + citations/tagged_kps/result） |
| POST | `/api/practice/turn` | Practice 客户回话 + 教练评分（未启用 RAG） |
| POST | `/api/quiz/generate` | 生成 5 题 |
| POST | `/api/quiz/grade` | 评分 |
| GET  | `/api/kp` / `/api/kp/{id}` / `POST /api/kp` / `PATCH /api/kp/{id}` / `POST /api/kp/{id}/approve` | KP Registry admin |
| GET  | `/healthz` | 基本健康检查 |
| GET  | `/healthz/rag` | MySQL/Redis/Milvus 连通性检查 |

AIQA SSE 事件类型：`citations` → `tagged_kps` → `token`(多次) → `result` → `done`；
异常时可能多出 `error` / `fallback`。

## 切换厂商

只需改 `.env` 的 `OPENAI_BASE_URL` + `MODEL_NAME`，无需改代码。
