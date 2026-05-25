from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_SERVER_DIR = Path(__file__).resolve().parents[1]
_REPO_DIR = _SERVER_DIR.parent


class Settings(BaseSettings):
    # Load env files by absolute path so starting uvicorn from the repo root or
    # from server/ behaves the same. Later files override earlier files.
    model_config = SettingsConfigDict(
        env_file=(str(_REPO_DIR / ".env"), str(_SERVER_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://api.deepseek.com/v1"
    model_name: str = "deepseek-chat"
    temperature: float = 0.6
    allow_origins: str = "http://localhost:5173"

    # ── RAG 栈 ─────────────────────────────────────────────
    mysql_dsn: str = "mysql+aiomysql://simugo:simugo@127.0.0.1:3306/simugo_kb"
    mysql_dsn_sync: str = "mysql+pymysql://simugo:simugo@127.0.0.1:3306/simugo_kb"
    redis_url: str = "redis://127.0.0.1:6379/0"
    milvus_uri: str = "http://127.0.0.1:19530"
    milvus_collection: str = "kb_chunks"
    milvus_dim: int = 1024

    # Embedding provider: "siliconflow" | "zhipu" | "dashscope" | "openai_compat"
    embedding_provider: str = "siliconflow"
    embedding_model: str = "BAAI/bge-m3"
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.siliconflow.cn/v1"

    # KP 抽取
    kp_extract_model: str = ""  # 空则复用 model_name
    kp_extract_batch_size: int = 8
    kp_dedupe_threshold: float = 0.85

    # 内部 API 鉴权（最小方案）：所有 /api/* 写入接口与 KB 检索都要求 X-Internal-Token 头
    # 留空时表示"开发模式不校验"，生产必须设置
    internal_token: str = ""

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allow_origins.split(",") if o.strip()]

    @property
    def kp_model_name(self) -> str:
        return self.kp_extract_model or self.model_name


settings = Settings()
