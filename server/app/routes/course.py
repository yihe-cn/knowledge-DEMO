"""学员端「课程」只读接口。

把 admin 后台创建的 Product + 绑定的 approved KP，按前端 productCatalog
所需的形状（meta / knowledge[modules→points] / customer / customers / script）
拼装后返回，让前端可以动态加载新建的产品课程，不再需要改 data.js。
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import (
    KpProductLink,
    KpRegistry,
    KpStatus,
    Product,
    ProductStatus,
    get_session,
)

router = APIRouter()


# 行业 → 默认图标 / 配色（前端 ProductCard 头部用）
_INDUSTRY_FALLBACK: dict[str, dict[str, str]] = {
    "汽车销售": {"icon": "🚗", "color": "cyan"},
    "医药学术": {"icon": "🩺", "color": "sage"},
    "金融理财": {"icon": "💼", "color": "gold"},
    "教育培训": {"icon": "📚", "color": "warm"},
}
_DEFAULT_ICON = "🧭"
_DEFAULT_COLOR = "cyan"


def _meta_from_product(p: Product, kp_total: int) -> dict[str, Any]:
    industry = p.industry or ""
    fallback = _INDUSTRY_FALLBACK.get(industry, {})
    short = p.name[:6] if len(p.name) > 6 else p.name
    return {
        "name": p.name,
        "shortName": short,
        "industry": industry or "通用",
        "industryIcon": fallback.get("icon", _DEFAULT_ICON),
        "color": fallback.get("color", _DEFAULT_COLOR),
        "studentRole": p.student_role or "学员",
        "customerLabel": p.customer_label or "客户",
        "storeContext": "",
        "aiqaDomain": p.name,
        "aiqaContext": f"{p.name} 训练平台的「产品私教」，对象是{p.student_role or '学员'}",
        "practiceSummary": f"{p.customer_label or '客户'} · 默认场景",
        "scenarioCode": p.code.upper()[:6],
        "scenarioGoals": [],
        "scenarioBrief": p.description or "",
        "knowledgeTotal": kp_total,
        # 前端用此判断「该 product 来自后端，未在 PRODUCTS 静态注册」
        "fromBackend": True,
    }


def _default_customer(p: Product) -> dict[str, Any]:
    """根据 product 字段生成占位客户人设。脚本暂为空。"""
    cust_label = p.customer_label or "客户"
    role = p.student_role or "学员"
    return {
        "id": "default",
        "name": f"{cust_label} A",
        "age": 35,
        "job": p.industry or "",
        "budget": "",
        "family": "",
        "city": "",
        "context": p.description or f"{p.name} · 默认演练场景",
        "avatar": cust_label[0] if cust_label else "客",
        "mood": {"interest": 50, "trust": 40},
        "tagline": "默认人设 · 待管理员配置",
        "vibe": "默认",
        "emoji": "🙂",
        "avatarColor": "dark",
        "motivation": f"{cust_label}对 {p.name} 感兴趣，今天来了解。",
        "opener": f"你好，能简单介绍下{p.name}吗？",
        "personality": [],
        "concerns": [],
        "promptSeed": (
            f"你扮演{p.industry or ''}场景下的一位{cust_label}，"
            f"今天来了解 {p.name}。\n"
            f"对话规则：\n"
            f"- 你是{cust_label}，不是{role}。保持客户视角，问问题、表达顾虑、给反应。\n"
            f"- 短回复，一次 1-2 句，不超过 60 字。\n"
            f"- 不要扮演{role}或旁白。"
        ),
    }


def _kp_to_point(kp: KpRegistry) -> dict[str, Any]:
    return {
        "id": f"kp-{kp.id}",
        "title": kp.name,
        "tier": "detail",
        "spec": kp.definition or "",
        "customerVoice": "",
        "sales": "",
        "sources": [],
        "appliesTo": [],
        "notApplicable": [],
        "rebuttals": [],
    }


def _build_modules(kps: list[KpRegistry]) -> list[dict[str, Any]]:
    """按 category 聚合 KP 为模块；保持首次出现顺序。"""
    groups: "OrderedDict[str, list[KpRegistry]]" = OrderedDict()
    for kp in kps:
        key = (kp.category or "").strip() or "通用知识"
        groups.setdefault(key, []).append(kp)

    modules: list[dict[str, Any]] = []
    for idx, (category, items) in enumerate(groups.items(), start=1):
        modules.append({
            "id": f"m{idx}",
            "title": category,
            "icon": "📘",
            "color": _DEFAULT_COLOR,
            "summary": f"{len(items)} 个知识点",
            "progress": 0,
            "points": [_kp_to_point(k) for k in items],
        })
    return modules


async def _fetch_product_kps(session: AsyncSession, product_id: int) -> list[KpRegistry]:
    stmt = (
        select(KpRegistry)
        .join(KpProductLink, KpProductLink.kp_id == KpRegistry.id)
        .where(KpProductLink.product_id == product_id)
        .where(KpRegistry.status == KpStatus.approved)
        .order_by(KpRegistry.id)
    )
    return list((await session.execute(stmt)).scalars().all())


@router.get("/courses")
async def list_courses(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """列出所有 active 产品，返回前端 PRODUCTS 形状的轻量元数据。"""
    products = (
        await session.execute(
            select(Product)
            .where(Product.status == ProductStatus.active)
            .order_by(Product.id)
        )
    ).scalars().all()

    if not products:
        return {"items": []}

    # 批量统计 approved KP 数量
    counts_rows = (
        await session.execute(
            select(
                KpProductLink.product_id,
                KpRegistry.id,
            )
            .join(KpRegistry, KpRegistry.id == KpProductLink.kp_id)
            .where(KpRegistry.status == KpStatus.approved)
        )
    ).all()
    counts: dict[int, int] = {}
    for pid, _ in counts_rows:
        counts[pid] = counts.get(pid, 0) + 1

    items = [
        {
            "id": p.code,
            "meta": _meta_from_product(p, counts.get(p.id, 0)),
        }
        for p in products
    ]
    return {"items": items}


@router.get("/courses/{product_code}")
async def get_course(
    product_code: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """返回单个产品的完整课程数据：knowledge 模块、默认客户、空剧本。"""
    p = (
        await session.execute(select(Product).where(Product.code == product_code))
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(404, f"product {product_code} not found")
    if p.status != ProductStatus.active:
        raise HTTPException(404, f"product {product_code} is not active")

    kps = await _fetch_product_kps(session, p.id)
    modules = _build_modules(kps)
    customer = _default_customer(p)

    return {
        "id": p.code,
        "meta": _meta_from_product(p, len(kps)),
        "knowledge": modules,
        "customer": customer,
        "customers": [customer],
        "script": [],
    }
