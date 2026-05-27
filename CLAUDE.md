# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 该仓库已有 [Agents.md](Agents.md)，里面包含更详细的后端/前端约定、验证要求和交付说明。本文档是面向 Claude Code 的精简补充，开始工作前两者都应通读一遍。

## 仓库布局

三个独立子项目，互相通过 HTTP/SSE 通信，没有 monorepo workspace 工具：

- `server/` — FastAPI + LangGraph 后端（Python ≥3.11，`uv` 管理依赖）。承载 AIQA / Practice / Quiz / Assessment / KP Registry / 课程 / 产品 / 后台 KB 全部 API。AIQA 走 Agentic RAG（Planner → Retriever → Reranker → Synthesizer → Verifier），所有 AI 接口 SSE 流式返回。
- `app/` — 学员端 Vite + React (JavaScript) + Tailwind。
- `admin/` — 管理端 Vite + React + TypeScript，使用 Ant Design、React Query、Axios、ECharts、React Router。
- `demo/` — Claude Design 导出的 HTML/CSS 原型；做界面还原前先读 `demo/README.md` 和 `demo/project/` 主设计文件。
- `Knowledge/` — 待入库的知识库素材（PPTX/PDF 等）。
- `Agentic RAG 实现路径/` — RAG 方案设计资料。

## 常用命令

### 一键启动 / 重启前后端
仓库根有统一脚本，默认 `app` 在 5173、`server` 在 8000：

```bash
./restart.sh            # stop + start 两个服务
./restart.sh start | stop | status
# 日志: /tmp/simugo-app.log, /tmp/simugo-server.log
```

### 后端（`server/`）

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000

# RAG 全栈（Milvus + MySQL + Redis + Celery）
docker compose up -d
uv run alembic upgrade head
./scripts/worker.sh
curl http://localhost:8000/healthz       # 基本健康
curl http://localhost:8000/healthz/rag   # RAG 子系统连通性

# 文档入库 / KP 抽取（同步 CLI）
uv run python -m app.ingestion.cli ingest "../Knowledge/<file>"
uv run python -m app.ingestion.cli ls
uv run python -m app.ingestion.cli extract <doc_id>
```

数据库变更必须配套 Alembic migration（`server/migrations/`），不要只改 SQLAlchemy model。

### 前端

```bash
# 学员端
cd app && npm install && npm run dev      # 或 npm run build

# 管理端 (build 会先跑 tsc -b)
cd admin && npm install && npm run dev    # 或 npm run build
```

仓库没有统一 lint / test 命令；后端没有测试套件，验证依赖 `/healthz`、`/healthz/rag` 和 `curl` 接口；前端验证使用 `npm run build` + 浏览器手验。

## 架构要点

### 后端模块边界
- `server/app/main.py` 注册所有 router；新 API 在 `server/app/routes/` 下加文件并挂上去。
- AI 业务逻辑统一放 `server/app/graphs/`（LangGraph 图）：`qa_graph.py`（Agentic RAG）、`practice_graph.py`、`quiz_graph.py`、`assessment_graph.py`、`evaluation_graph.py`、`suggestor_graph.py`，共享检索逻辑在 `_retrieval.py`。
- 跨模块共享基础设施：`llm.py`（模型客户端）、`sse.py`（SSE 工具）、`embeddings.py`、`reranker.py`、`vector_store.py`（Milvus）、`config.py`（pydantic-settings 读 `.env`）、`security.py`、`celery_app.py`。
- 数据层：`server/app/db/` 是 SQLAlchemy（async）模型与会话；`server/app/kp_extraction/` 负责 KP 抽取/富化；`server/app/ingestion/` 是文档入库管线（PPTX/PDF → chunk → 向量 → Milvus）。
- 模型/厂商切换通过 `.env` 的 `OPENAI_BASE_URL` + `MODEL_NAME` 完成，业务代码不要写死。

### SSE 事件契约
AIQA 当前事件顺序需保持稳定：`citations` → `tagged_kps` → 多次 `token` → `result` → `done`；异常路径可能多出 `error` / `fallback`。前端 (`app/src/screens/AIQA.jsx` 等) 按此顺序解析，改动后端事件名/顺序前要同步前端解析逻辑。

### 前端分层
- `admin/src/api/` 是管理端的 axios client 集合（`kp.ts` / `product.ts` / `assessment.ts` / `courseAssignment.ts` 等）。新增 CRUD 请求放这里，不要在页面里散落裸 `fetch`/`axios`。
- `admin/` 已统一使用 Ant Design + React Query；新增表格/表单/弹窗优先复用既有页面模式。
- `app/` 使用 Tailwind + 自定义 `theme.js`、`index.css`、`components/Primitives.jsx`；改样式先看现有组件。
- HR 后台模块在 `admin/src/hr/` 是独立子应用（`HrApp.tsx` + 自己的 `api.ts` / `Shell.tsx` / `styles.css`），不要和主 admin 路由的页面混 import。

### RAG 一致性
RAG 相关改动要同时考虑 MySQL（KP/文档元数据）、Milvus（chunk 向量与 `kp_ids` 反向标签）、Redis、Celery worker 四处状态。KP `approve` 时会回写 Milvus 的 `kb_chunks.kp_ids` 让 Retriever 后续可按 KP 过滤——这条链路不要破坏。

## 修改约束（来自 Agents.md，浓缩版）

- 改动范围紧贴任务，不顺手重构无关代码；保留用户已有未提交改动。
- 配置走 `.env` + `config.py`，密钥/模型名/base URL 不要进业务代码或提交。
- 多端联动改动（schema/API/UI）一次性同步完成。
- 中文业务文案保持中文，代码标识符英文。
- 不提交构建产物（`app/dist`、`admin/dist`）、`.env`、缓存；仓库里已有的产物文件不要为当前任务扩大改动。

## 交付回复需包含

- 改了哪些文件
- 跑了哪些验证命令（`npm run build` / `curl /healthz` / `/healthz/rag` / `docker compose` / Alembic 等）
- 哪些验证未执行及原因（缺密钥、缺依赖服务等）
- 如需后续手动步骤，给出具体命令或页面路径
