# SIMUGO Server

FastAPI + LangGraph 后端，承载三类 AI 调用（AIQA / Practice / Quiz），全部走 SSE 流式。

## 启动

```bash
cd server
cp .env.example .env       # 填入 OPENAI_API_KEY 等
uv sync                    # 或 pip install -e .
uv run uvicorn app.main:app --reload --port 8000
```

## 路由

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/qa` | AIQA 单轮问答（流式 token + 结构化 citations/followups） |
| POST | `/api/practice/turn` | Practice 客户回话（流式）+ 教练评分（result） |
| POST | `/api/quiz/generate` | 生成 5 题（result） |
| POST | `/api/quiz/grade` | 评分（流式 comment + result） |
| GET  | `/healthz` | 健康检查 |

所有响应均为 SSE，事件类型：`token` / `result` / `error` / `done`。

## 切换厂商

只需改 `.env` 的 `OPENAI_BASE_URL` + `MODEL_NAME`，无需改代码。
