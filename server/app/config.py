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
    # Demo 默认走 SQLite + Milvus Lite，全部落在 /data 下，单容器即可启动。
    # 通过环境变量 MYSQL_DSN / MYSQL_DSN_SYNC 可切回外部 MySQL。
    mysql_dsn: str = "sqlite+aiosqlite:////data/app.db"
    mysql_dsn_sync: str = "sqlite:////data/app.db"
    redis_url: str = "redis://127.0.0.1:6379/0"
    # Milvus Lite 本地 .db 文件路径（嵌入式，无独立 Milvus 服务）
    milvus_db_path: str = "/data/milvus.db"
    milvus_collection: str = "kb_chunks"
    milvus_dim: int = 1024

    # Embedding provider: "siliconflow" | "zhipu" | "dashscope" | "openai_compat"
    embedding_provider: str = "siliconflow"
    embedding_model: str = "BAAI/bge-m3"
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.siliconflow.cn/v1"

    # Reranker：默认与 embedding 同源（SiliconFlow），留空则在 reranker.py 里 fallback 到 embedding 凭证
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    reranker_api_key: str = ""
    reranker_base_url: str = ""

    # KP 抽取
    kp_extract_model: str = ""  # 空则复用 model_name
    kp_extract_batch_size: int = 8
    kp_dedupe_threshold: float = 0.85

    # Planner（共指消解 + 多 query 扩写）
    planner_model: str = ""            # 空则用 model_name；生产推荐 fast 档（如 deepseek-chat-lite）
    planner_timeout_ms: int = 1500     # Planner LLM 单次硬超时；超时降级为原句单 query
    planner_variants: int = 2          # 期望生成的语义变体数（不含 rewritten_query 本身）

    # 经验回答（KB 未命中时基于产品 features_brief + 行业常识兜底）
    experience_answer_enabled: bool = True    # 全局开关
    experience_model: str = ""                # 空则 fallback 到 model_name；生产建议设强模型
    experience_temperature: float = 0.4
    # rerank top1 分数低于此阈值，视作 KB 检索"未命中"，走经验分支。
    # bge-reranker-v2-m3 sigmoid 分数：>0.5 通常强相关；0.2-0.5 边缘相关；<0.2 几乎无关。
    experience_rerank_score_threshold: float = 0.2
    # 经验模式下"最接近的相关材料"展示阈值：rerank top1 score 低于此值则不展示
    # （避免给学员看几乎完全无关的材料）
    experience_closest_match_min_score: float = 0.05

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
