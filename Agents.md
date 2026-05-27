# Agents.md

本文件给后续 coding agents 使用。开始任何修改前先读本文件，再读相关子项目的 README、配置和目标代码。

## 项目结构

- `server/`: FastAPI + LangGraph 后端，负责 AIQA、Practice、Quiz、KP Registry、课程、产品和后台相关 API。AIQA 使用 Agentic RAG，SSE 流式返回。
- `app/`: 面向学员端的 Vite + React 应用。
- `admin/`: 面向管理端的 Vite + React + TypeScript 应用，使用 Ant Design、React Query、Axios、ECharts。
- `demo/`: Claude Design 导出的 HTML/CSS/JS 原型。实现界面时先读 `demo/README.md`，再从 `demo/project/` 的主设计文件沿 imports 逐层阅读。
- `Knowledge/`: 知识库素材和可入库资料。
- `Agentic RAG 实现路径/`: RAG 方案和实现相关资料。

## 常用命令

### 后端

```bash
cd server
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

完整 RAG 栈：

```bash
cd server
docker compose up -d
uv run alembic upgrade head
./scripts/worker.sh
curl http://localhost:8000/healthz/rag
```

文档入库和 KP 抽取：

```bash
cd server
uv run python -m app.ingestion.cli ingest "../Knowledge/<file>"
uv run python -m app.ingestion.cli ls
uv run python -m app.ingestion.cli extract <doc_id>
```

### 学员端

```bash
cd app
npm install
npm run dev
npm run build
```

### 管理端

```bash
cd admin
npm install
npm run dev
npm run build
```

## 后端约定

- API 入口集中在 `server/app/routes/`，新增接口优先沿用现有 router、schema 和 service/graph 分层方式。
- Pydantic schema 优先放在现有 schema 模块或对应路由附近，避免在 handler 中拼接未定义结构。
- AI 调用相关逻辑优先复用 `server/app/llm.py`、`server/app/sse.py`、`server/app/graphs/`、`server/app/embeddings.py`、`server/app/reranker.py` 和 `server/app/vector_store.py`。
- SSE 接口要保持事件格式稳定。AIQA 当前主要事件顺序是 `citations`、`tagged_kps`、多次 `token`、`result`、`done`，异常时可能有 `error` 或 `fallback`。
- 数据库变更需要配套 Alembic migration，不能只改 SQLAlchemy model。
- RAG 相关变更要考虑 MySQL、Milvus、Redis 和 Celery worker 的一致性。
- 配置优先走 `.env` 和 `server/app/config.py`，不要把密钥、模型名、base URL 写死在业务代码里。

## 前端约定

- `app/` 是 JavaScript React 项目，`admin/` 是 TypeScript React 项目。不要在两个项目之间随意混用约定。
- `admin/` 已使用 Ant Design 和 React Query，管理端新增 CRUD、表格、表单和弹窗时优先沿用这些依赖和既有页面模式。
- `app/` 以 Vite、React、Tailwind 为主。新增样式前先检查 `app/src/index.css`、`app/src/theme.js` 和现有组件写法。
- API client 相关修改优先放在 `admin/src/api/` 或现有前端数据访问层，不要在页面中散落裸 `fetch`/`axios` 调用。
- 设计还原任务应先阅读 `demo/project/` 源文件和 CSS，不要直接复制原型内部结构，目标是按当前技术栈实现相同视觉和交互。
- 修改 UI 后，至少运行对应项目的 `npm run build`。涉及用户流程时启动 dev server 并做浏览器验证。

## 验证要求

- 后端逻辑变更：至少运行能覆盖目标模块的命令；没有测试时运行相关健康检查或用 `curl` 验证接口。
- `server/` 基础健康检查：

```bash
curl http://localhost:8000/healthz
```

- `app/` 和 `admin/` 修改后分别运行：

```bash
npm run build
```

- 涉及 RAG、入库、KP、异步任务时，说明是否验证了 docker compose、Alembic、Celery worker 和 `/healthz/rag`。
- 如果因为缺少密钥、依赖服务或本地环境无法验证，要在最终回复中明确说明未验证项和原因。

## 编辑规则

- 保持修改范围紧贴任务，不做无关重构。
- 不提交密钥、`.env`、构建产物和缓存文件。仓库里已有产物或缓存时，不要为了当前任务扩大改动。
- 遇到用户已有未提交改动时，保留并绕开，不要回滚。
- 优先复用现有模式和依赖。只有在明显降低复杂度或符合已有架构时才新增抽象。
- 中文业务文案保持中文语境一致；代码标识符保持英文、清晰、可搜索。
- 多端联动修改时，同时更新后端 schema/API、前端调用和相关 UI 状态处理。

## 交付说明

最终回复应包含：

- 改了哪些文件。
- 运行了哪些验证命令。
- 哪些验证未执行及原因。
- 如有后续手动步骤，说明具体命令或页面路径。
