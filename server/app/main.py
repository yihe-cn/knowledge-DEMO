import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings

# 让 app.* 包下的 _log.info 能输出（默认 logger 是 WARNING 级别，路由 / 调度类决策日志全被吞）
# 通过 LOG_LEVEL 环境变量可调（DEBUG / INFO / WARNING / ERROR）
_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.getLogger("app").setLevel(getattr(logging, _LEVEL, logging.INFO))
# 没装 root handler 时补一个（uvicorn 起来后会装自己的，这里兜底防控制台空白）
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
from .routes import (
    admin_kb,
    assessment,
    assessment_admin,
    course,
    course_assignment,
    course_ai,
    dashboard,
    kp,
    learning,
    practice,
    practice_role as practice_role_routes,
    product,
    qa,
    quiz,
)

app = FastAPI(title="SIMUGO Server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "model": settings.model_name, "base_url": settings.openai_base_url}


@app.get("/healthz/rag")
async def healthz_rag():
    """检查 MySQL / Redis / Milvus 三个依赖连通性。"""
    from sqlalchemy import text
    import redis.asyncio as aioredis  # type: ignore

    result: dict = {}

    # MySQL
    try:
        from .db.session import engine
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        result["mysql"] = "ok"
    except Exception as e:
        result["mysql"] = f"err: {e}"

    # Redis
    try:
        r = aioredis.from_url(settings.redis_url)
        await r.ping()
        await r.close()
        result["redis"] = "ok"
    except Exception as e:
        result["redis"] = f"err: {e}"

    # Milvus
    try:
        from .vector_store import get_collection
        coll = get_collection()
        result["milvus"] = f"ok ({coll.num_entities} entities)"
    except Exception as e:
        result["milvus"] = f"err: {e}"

    return result


from fastapi import Depends
from .security import require_internal_token

# QA / KP / KB / Dashboard 接口需要 internal token
app.include_router(qa.router, prefix="/api", dependencies=[Depends(require_internal_token)])
app.include_router(kp.router, prefix="/api", dependencies=[Depends(require_internal_token)])
app.include_router(admin_kb.router, prefix="/api", dependencies=[Depends(require_internal_token)])
app.include_router(dashboard.router, prefix="/api", dependencies=[Depends(require_internal_token)])
app.include_router(product.router, prefix="/api", dependencies=[Depends(require_internal_token)])
app.include_router(
    practice_role_routes.router, prefix="/api", dependencies=[Depends(require_internal_token)]
)
app.include_router(
    course_ai.router, prefix="/api", dependencies=[Depends(require_internal_token)]
)
# 考核 admin 接口：internal token 守门；学员端走 token 链接，挂在公开路由下。
app.include_router(
    assessment_admin.router, prefix="/api", dependencies=[Depends(require_internal_token)]
)
app.include_router(
    course_assignment.router, prefix="/api", dependencies=[Depends(require_internal_token)]
)
app.include_router(assessment.router, prefix="/api")
# Practice /turn 仍走老契约（人设 LLM 对话，不接 KB），保持不校验。
# Practice /suggest 走 RAG（KB chunk + LLM），独立子 router 加 internal token 校验。
# Quiz 同样暂未接 RAG。
# Course 接口供学员端动态加载产品课程，公开只读，不需要 internal token
app.include_router(course.router, prefix="/api")
# 学习闭环（swipe + 逐 KP 考核）：学员侧公开（account 弱身份），admin 侧的考题/编排在 kp/product 路由内
app.include_router(learning.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(practice.suggest_router, prefix="/api")
app.include_router(quiz.router, prefix="/api")

# 上传文件静态服务；路由注册完成后再 mount，避免路径冲突。
_uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")
