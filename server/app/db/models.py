from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class DocStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class KpStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    archived = "archived"


class LinkSource(str, enum.Enum):
    llm = "llm"
    manual = "manual"


class ProductStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class ProductLinkSource(str, enum.Enum):
    auto = "auto"
    manual = "manual"


class PracticeRoleSource(str, enum.Enum):
    ai = "ai"
    manual = "manual"


class Product(Base):
    """业务产品维度。对应学员端 productCatalog 里的一个产品（如极氪 007、宝怡乐 PAX）。"""

    __tablename__ = "product"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    industry: Mapped[str] = mapped_column(String(64), default="")
    student_role: Mapped[str] = mapped_column(String(64), default="")
    customer_label: Mapped[str] = mapped_column(String(64), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # 产品/行业特征简介：KB 未命中时喂给经验回答模型作为背景上下文。
    # 留空 = 该产品不启用经验回答（即便 allow_experience_answer=True）。
    features_brief: Mapped[str] = mapped_column(Text, default="", nullable=False)
    allow_experience_answer: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )
    status: Mapped[ProductStatus] = mapped_column(
        Enum(ProductStatus, native_enum=False, length=16),
        default=ProductStatus.active,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class KpProductLink(Base):
    """KP ↔ Product 多对多。一个 KP 可挂多个产品（通用话术 KP 跨产品复用）。"""

    __tablename__ = "kp_product_link"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kp_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("kp_registry.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[ProductLinkSource] = mapped_column(
        Enum(ProductLinkSource, native_enum=False, length=16),
        default=ProductLinkSource.auto,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("kp_id", "product_id", name="uq_kp_product"),)


class KbDocument(Base):
    __tablename__ = "kb_document"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime: Mapped[str] = mapped_column(String(128), default="")
    product_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[DocStatus] = mapped_column(
        Enum(DocStatus, native_enum=False, length=32), default=DocStatus.pending, nullable=False
    )
    error: Mapped[str] = mapped_column(Text, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    chunks: Mapped[list["KbChunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class KbChunk(Base):
    __tablename__ = "kb_chunk"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    doc_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kb_document.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    # 溯源元数据：pptx 的 slide_index、pdf 的 page，统一塞 JSON
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    document: Mapped[KbDocument] = relationship(back_populates="chunks")
    kp_links: Mapped[list["KpChunkLink"]] = relationship(back_populates="chunk", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("doc_id", "chunk_index", name="uq_chunk_doc_idx"),
    )


class KpRegistry(Base):
    __tablename__ = "kp_registry"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    definition: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[KpStatus] = mapped_column(
        Enum(KpStatus, native_enum=False, length=32), default=KpStatus.draft, nullable=False
    )
    created_by: Mapped[str] = mapped_column(String(64), default="llm")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    chunk_links: Mapped[list["KpChunkLink"]] = relationship(back_populates="kp", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_kp_status", "status"),
    )


class KpChunkLink(Base):
    __tablename__ = "kp_chunk_link"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kp_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kp_registry.id", ondelete="CASCADE"), index=True)
    chunk_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kb_chunk.id", ondelete="CASCADE"), index=True)
    relevance: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[LinkSource] = mapped_column(
        Enum(LinkSource, native_enum=False, length=16), default=LinkSource.llm
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    kp: Mapped[KpRegistry] = relationship(back_populates="chunk_links")
    chunk: Mapped[KbChunk] = relationship(back_populates="kp_links")

    __table_args__ = (
        UniqueConstraint("kp_id", "chunk_id", name="uq_kp_chunk"),
    )


class KpExtractionJob(Base):
    """KP 抽取 Spike 留痕：每个 doc 一行（或多行重跑）。"""

    __tablename__ = "kp_extraction_job"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    doc_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("kb_document.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    new_kp_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_output: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PracticeRole(Base):
    """产品下的演练角色（客户人设）。一个产品有 1 个 default + 多个备选。"""

    __tablename__ = "practice_role"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product.id", ondelete="CASCADE"), index=True, nullable=False
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    name: Mapped[str] = mapped_column(String(64), default="")
    age: Mapped[int] = mapped_column(Integer, default=35)
    job: Mapped[str] = mapped_column(String(128), default="")
    city: Mapped[str] = mapped_column(String(64), default="")
    family: Mapped[str] = mapped_column(String(255), default="")
    budget: Mapped[str] = mapped_column(String(128), default="")

    tagline: Mapped[str] = mapped_column(String(255), default="")
    vibe: Mapped[str] = mapped_column(String(64), default="")
    emoji: Mapped[str] = mapped_column(String(16), default="🙂")
    avatar: Mapped[str] = mapped_column(String(16), default="客")
    avatar_color: Mapped[str] = mapped_column(String(32), default="dark")

    motivation: Mapped[str] = mapped_column(Text, default="")
    opener: Mapped[str] = mapped_column(Text, default="")
    context: Mapped[str] = mapped_column(Text, default="")
    prompt_seed: Mapped[str] = mapped_column(Text, default="")

    personality: Mapped[list] = mapped_column(JSON, default=list)
    concerns: Mapped[list] = mapped_column(JSON, default=list)
    mood: Mapped[dict] = mapped_column(JSON, default=dict)

    source: Mapped[PracticeRoleSource] = mapped_column(
        Enum(PracticeRoleSource, native_enum=False, length=16),
        default=PracticeRoleSource.ai,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
