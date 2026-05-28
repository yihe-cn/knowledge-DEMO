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
    milvus_kp_collection: str = "kp_embeddings"
    milvus_dim: int = 1024

    # 用户上传文件根目录（产品封面、KB 文档原始件）。
    # 留空时各 route 沿用旧默认 `server/uploads`；Docker 部署设为 /data/uploads 走持久卷。
    uploads_dir: str = ""

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
    # 单次 LLM 调用的读超时（秒）。批次大、要求枚举完整时容易跑长。
    kp_llm_timeout: int = 180
    # 单批超时时自动二分降级的最大递归深度（8 → 4 → 2 → 1）
    kp_batch_split_depth: int = 3

    # Planner（共指消解 + 多 query 扩写）
    planner_model: str = ""            # 空则用 model_name；生产推荐 fast 档（如 deepseek-chat-lite）
    planner_timeout_ms: int = 1500     # Planner LLM 单次硬超时；超时降级为原句单 query
    planner_variants: int = 2          # 期望生成的语义变体数（不含 rewritten_query 本身）

    # Verifier reflection（KP 覆盖检查 + 反思重检索）
    verifier_reflection_enabled: bool = True
    verifier_core_kp_min_rerank: float = 0.4     # 低于此 rerank 分的 core KP 不算"该覆盖却没覆盖"
    verifier_reflection_max_kp_chunks: int = 6   # reflection 每次额外拉的 chunk 上限
    verifier_reflection_per_kp_chunks: int = 2   # 每个 missed KP 最多带几条支持 chunk

    # 经验回答（KB 未命中时基于产品 features_brief + 行业常识兜底）
    experience_answer_enabled: bool = True    # 全局开关
    experience_model: str = ""                # 空则 fallback 到 model_name；生产建议设强模型
    experience_temperature: float = 0.4
    # rerank top1 分数低于此阈值，视作 KB 检索"未命中"，走经验分支。
    # bge-reranker-v2-m3 sigmoid 分数：>0.5 通常强相关；0.2-0.5 边缘相关；<0.2 几乎无关。
    experience_rerank_score_threshold: float = 0.2
    # 经验模式下"最接近的相关材料"展示下限：默认 0.0 = 只要 rerank/cosine 出了有限正值就展示。
    # 设计意图是诚实告诉学员"系统找到的最接近的就这条"，分数低本身就是有价值的信号
    # （让学员看到 KB 真的没货）。如果想隐藏极低分数的材料可以调高。
    experience_closest_match_min_score: float = 0.0

    # 内部 API 鉴权（最小方案）：所有 /api/* 写入接口与 KB 检索都要求 X-Internal-Token 头
    # 留空时表示"开发模式不校验"，生产必须设置
    internal_token: str = ""

    # 考核分享链接的前端 base URL（拼到 token 前）。例如 https://learn.simugo.app
    # 留空则只返回 ?token=xxx 路径片段，admin 端可自行拼当前域。
    assessment_share_base_url: str = ""

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allow_origins.split(",") if o.strip()]

    @property
    def kp_model_name(self) -> str:
        return self.kp_extract_model or self.model_name


settings = Settings()
