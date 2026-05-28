import logging
import os
from pathlib import Path

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


@app.on_event("startup")
def _init_demo_schema() -> None:
    """Demo 模式（SQLite）下，启动时自动建表 + 准备 /data 目录。

    生产 MySQL 部署不会跑到这里，因为 SQLite 检测条件不成立。
    """
    if not settings.mysql_dsn_sync.startswith("sqlite"):
        return
    # 解析 sqlite:////data/app.db → /data/app.db；如果是相对路径就跳过创建目录
    db_path = settings.mysql_dsn_sync.split("sqlite:///", 1)[-1]
    if db_path.startswith("/"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.milvus_db_path).parent.mkdir(parents=True, exist_ok=True)

    from .db import Base
    from .db.session import sync_engine

    Base.metadata.create_all(sync_engine)


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
        from .vector_store import num_entities
        result["milvus"] = f"ok ({num_entities()} entities)"
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

# 上传文件静态服务；必须在 SPA 根 mount 之前挂，否则会被 / 吞掉。
# Docker 部署通过 UPLOADS_DIR=/data/uploads 把目录挪到持久卷，避免重建容器丢图。
_uploads_dir = settings.uploads_dir or os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# 前端静态资源：必须在所有 API 路由注册完毕之后挂，否则 / 会吞掉 /api/*。
# FRONTEND_DIST / ADMIN_DIST 在镜像里固定为 /app/frontend、/app/admin。
# 学员端挂在 /；管理后台挂在 /admin/（子路径，与 admin/vite.config.ts 的 base 一致）。
_frontend_dist = os.environ.get("FRONTEND_DIST", "/app/frontend")
_admin_dist = os.environ.get("ADMIN_DIST", "/app/admin")

if os.path.isdir(_frontend_dist):
    from fastapi.responses import FileResponse
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from fastapi.exception_handlers import http_exception_handler

    _index_html = Path(_frontend_dist) / "index.html"
    _admin_index_html = Path(_admin_dist) / "index.html"
    _has_admin = _admin_index_html.is_file()

    _spa_skip_prefixes = ("/api", "/healthz", "/openapi", "/docs", "/redoc", "/uploads")

    @app.exception_handler(StarletteHTTPException)
    async def _spa_fallback(request, exc: StarletteHTTPException):
        """SPA fallback：
        - 以 /admin/ 开头的未知路径 → admin index.html（React Router 处理）
        - 其他非 API/docs 路径 → 学员端 index.html
        - API / 文档路径 → 正常 404
        """
        if exc.status_code == 404:
            path = request.url.path
            if _has_admin and (path == "/admin" or path.startswith("/admin/")):
                return FileResponse(_admin_index_html)
            if not path.startswith(_spa_skip_prefixes) and _index_html.is_file():
                return FileResponse(_index_html)
        return await http_exception_handler(request, exc)

    # admin 必须在 frontend 之前 mount，否则 /admin/ 会被根 StaticFiles 拦截
    if _has_admin:
        app.mount("/admin", StaticFiles(directory=_admin_dist, html=True), name="admin")
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
