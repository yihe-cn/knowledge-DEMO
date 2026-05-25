from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import qa, practice, quiz

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


app.include_router(qa.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(quiz.router, prefix="/api")
