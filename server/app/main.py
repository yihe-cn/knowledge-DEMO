from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import admin_kb, course, dashboard, kp, practice, product, qa, quiz

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
# Practice /turn 仍走老契约（人设 LLM 对话，不接 KB），保持不校验。
# Practice /suggest 走 RAG（KB chunk + LLM），独立子 router 加 internal token 校验。
# Quiz 同样暂未接 RAG。
# Course 接口供学员端动态加载产品课程，公开只读，不需要 internal token
app.include_router(course.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(practice.suggest_router, prefix="/api")
app.include_router(quiz.router, prefix="/api")
