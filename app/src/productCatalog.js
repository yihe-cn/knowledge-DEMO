// productCatalog.js — 多产品 / 多账号注册表
//
// 单产品 MVP 时代，所有 screen 都通过 window.SIMUGO_DATA 直接读取 KNOWLEDGE / CUSTOMER / SCRIPT 等。
// 现在升级为多产品架构，screen 代码不动，由本模块在切换产品时重写 window.SIMUGO_DATA。
//
// PRODUCT_META 字段说明：
//   - name / shortName     : 显示名
//   - industry / icon      : 行业标签（在账号首页卡片上展示）
//   - color                : 主色调（cyan/sage/...，对应 theme 中的 accent 派生）
//   - studentRole          : 学员角色（如"销售顾问"/"医药代表"）
//   - customerLabel        : 客户在该场景的称呼（"客户"/"医生"）
//   - storeContext         : 演练场景上下文（如门店名称、拜访场景）
//   - aiqaDomain           : 给 AIQA system prompt 用的领域描述
//   - knowledgeTotal       : 知识点总数（学/练/评 进度计算）

import {
  KNOWLEDGE as ZEEKR_KNOWLEDGE,
  CUSTOMER as ZEEKR_CUSTOMER,
  CUSTOMERS as ZEEKR_CUSTOMERS,
  SCRIPT as ZEEKR_SCRIPT,
} from './data.js';
import {
  PAX_KNOWLEDGE,
  PAX_CUSTOMER,
  PAX_CUSTOMERS,
  PAX_SCRIPT,
} from './dataPax.js';

function buildIndices(product) {
  product.kpIndex = {};
  product.knowledge.forEach(m => m.points.forEach(p => {
    product.kpIndex[p.id] = { module: m, point: p };
  }));
  product.customerIndex = {};
  product.customers.forEach(c => { product.customerIndex[c.id] = c; });
  product.meta.knowledgeTotal = product.knowledge.reduce((a, m) => a + m.points.length, 0);
  return product;
}

// category → 模块 icon 兜底
const KP_CATEGORY_ICON = {
  '原理科普': '📘',
  '三电与续航': '⚡',
  '智能驾驶': '🛰',
  '销售话术': '💬',
  '产品知识': '📦',
};
function categoryIcon(category) {
  return KP_CATEGORY_ICON[category] || '📌';
}

// 把后端返回的 KP 列表合并进某个 product 的 kpIndex（按数字 id 覆盖 mock 同 id 项）
function mergeServerKps(product, items) {
  if (!product || !Array.isArray(items)) return;
  items.forEach(kp => {
    const card = kp.card || {};
    const point = {
      id: kp.id,
      title: kp.name,
      tier: card.tier || 'detail',
      spec: card.spec || kp.definition || '',
      customerVoice: card.customerVoice || '',
      sources: Array.isArray(card.sources) ? card.sources : [],
      appliesTo: Array.isArray(card.appliesTo) ? card.appliesTo : [],
      notApplicable: Array.isArray(card.notApplicable) ? card.notApplicable : [],
      rebuttals: Array.isArray(card.rebuttals) ? card.rebuttals : [],
      sales: card.sales || '',
    };
    const module_ = {
      title: kp.category || '未分类',
      icon: categoryIcon(kp.category),
      points: [point],
    };
    product.kpIndex[kp.id] = { module: module_, point };
  });
}

// 拉服务端某产品的 approved KPs，merge 到本地 product.kpIndex
// 仅对从后端注册的 product（有数字 backendId）有效；静态 mock 产品没数字 id，跳过。
async function loadServerKpsInto(product) {
  if (!product) return;
  // 仅对从后端注册（有 backendId）的产品拉富字段。
  // 走公开的 /courses/{code}/kps（不需 internal token），而非受保护的 /products/{id}/kps。
  if (!(product.meta && product.meta.backendId)) return;
  try {
    const resp = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(product.id)}/kps`);
    if (!resp.ok) return;
    const data = await resp.json();
    mergeServerKps(product, data.items || []);
  } catch (e) {
    console.warn('[productCatalog] loadServerKps failed:', e);
  }
}

export const PRODUCTS = {
  zeekr007: buildIndices({
    id: 'zeekr007',
    meta: {
      name: '极氪 007',
      shortName: '007',
      industry: '汽车销售',
      industryIcon: '🚗',
      color: 'cyan',
      studentRole: '销售顾问',
      customerLabel: '客户',
      storeContext: '前滩门店 · 周六下午',
      aiqaDomain: '极氪 007',
      aiqaContext: '极氪 007 销售训练平台的"产品私教"，对象是 4S 店销售顾问（学员）',
      practiceSummary: '客户：郑先生 · 4-6 轮对话',
      scenarioCode: 'S01',
      scenarioGoals: ['识别需求', '化解顾虑', '推进试驾'],
      scenarioBrief: '客人背着电脑包，从隔壁特斯拉看完进来，理性、爱比较。',
    },
    knowledge: ZEEKR_KNOWLEDGE,
    customer: ZEEKR_CUSTOMER,
    customers: ZEEKR_CUSTOMERS,
    script: ZEEKR_SCRIPT,
  }),
  pax: buildIndices({
    id: 'pax',
    meta: {
      name: '宝怡乐 PAX®',
      shortName: 'PAX',
      industry: '医药学术',
      industryIcon: '🍼',
      color: 'sage',
      studentRole: '医药代表',
      customerLabel: '医生',
      storeContext: '三甲医院儿科 · 学术拜访',
      aiqaDomain: '宝怡乐 PAX® 专利配方',
      aiqaContext: '宝怡乐 PAX 医药学术训练平台的"产品私教"，对象是医药代表（学员）',
      practiceSummary: '医生：张主任 · 5 轮学术对话',
      scenarioCode: 'P01',
      scenarioGoals: ['挖掘临床痛点', '回应学术质疑', '推进下次拜访'],
      scenarioBrief: '张主任翻开你递的资料，语气平和但直接，问"直接说差异化"。',
    },
    knowledge: PAX_KNOWLEDGE,
    customer: PAX_CUSTOMER,
    customers: PAX_CUSTOMERS,
    script: PAX_SCRIPT,
  }),
};

export const ACCOUNTS = [
  {
    id: 'linsheng',
    name: '林笙',
    avatar: '林',
    avatarColor: 'cyan',
    role: '销售顾问',
    org: '极氪 · 上海前滩门店',
    orgShort: 'STORE · 上海前滩',
    productIds: ['zeekr007'],
  },
  {
    id: 'lidaibiao',
    name: '李代表',
    avatar: '李',
    avatarColor: 'sage',
    role: '医药代表',
    org: '宝怡乐 · 华东大区儿科组',
    orgShort: 'EAST · 华东儿科组',
    productIds: ['pax'],
  },
];

export const ACCOUNT_INDEX = {};
ACCOUNTS.forEach(a => { ACCOUNT_INDEX[a.id] = a; });
export const DYNAMIC_ACCOUNT_IDS = new Set();

function avatarFromName(name, fallback) {
  const s = String(name || fallback || '学员').trim();
  return s.slice(0, 1).toUpperCase() || '学';
}

export function registerLearnerAccount(learnerOrRef) {
  const raw = typeof learnerOrRef === 'string'
    ? { external_ref: learnerOrRef, name: learnerOrRef }
    : (learnerOrRef || {});
  const id = String(raw.external_ref || raw.account || raw.id || '').trim();
  if (!id) return null;
  const name = String(raw.name || id).trim();
  const dept = String(raw.dept || '').trim();
  const next = {
    id,
    name,
    avatar: avatarFromName(name, id),
    avatarColor: 'cyan',
    role: '学员',
    org: dept || 'SIMUGO 学员',
    orgShort: dept || 'LEARNER',
    productIds: [],
  };
  const existing = ACCOUNT_INDEX[id];
  if (existing) {
    if (DYNAMIC_ACCOUNT_IDS.has(id)) Object.assign(existing, next);
    return existing;
  }
  ACCOUNT_INDEX[id] = next;
  ACCOUNTS.push(next);
  DYNAMIC_ACCOUNT_IDS.add(id);
  return next;
}

export function getAccount(accountRef) {
  if (accountRef && !ACCOUNT_INDEX[accountRef]) registerLearnerAccount(accountRef);
  return ACCOUNT_INDEX[accountRef] || ACCOUNTS[0];
}

let _activeProductId = null;

// ─── 后端动态产品 ──────────────────────────────────────────────
// admin 创建的产品通过 /api/courses/by-account 拉到前端，与上面静态注册的 PRODUCTS 合并。
// meta.fromBackend = true 用于在 AccountHome 区分来源。
// 注意：用 ?? 防御 VITE_API_BASE=""（单镜像同源）被当 falsy 落回 localhost:8000。
const API_BASE = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE : undefined)
  ?? 'http://localhost:8000';

export const REMOTE_PRODUCT_IDS = new Set();
export const ASSIGNED_PRODUCT_IDS = new Set();
export const VISIBILITY_STATE = { assignmentsLoaded: false };

function applyWindowData(p) {
  if (typeof window === 'undefined') return;
  window.SIMUGO_DATA = {
    KNOWLEDGE: p.knowledge,
    CUSTOMER: p.customer,
    CUSTOMERS: p.customers,
    CUSTOMER_INDEX: p.customerIndex,
    SCRIPT: p.script,
    KP_INDEX: p.kpIndex,
    PRODUCT: p,
  };
}

function _mergeRemoteItems(items, { exposeRemote = true } = {}) {
  items.forEach(item => {
    if (PRODUCTS[item.id] && PRODUCTS[item.id].knowledge) {
      // 静态产品：只合并后端元数据（backendId、coverImage），不覆盖本地 knowledge
      const existing = PRODUCTS[item.id];
      const remoteBackendId = item.meta && item.meta.backendId;
      const remoteCoverImage = item.meta && item.meta.coverImage;
      if (remoteBackendId && !(existing.meta && existing.meta.backendId)) {
        existing.meta = { ...(existing.meta || {}), backendId: remoteBackendId };
      }
      if (remoteCoverImage) {
        existing.meta = { ...(existing.meta || {}), coverImage: remoteCoverImage };
      }
      return;
    }
    PRODUCTS[item.id] = {
      id: item.id,
      meta: item.meta,
      knowledge: null,
      customer: null,
      customers: [],
      customerIndex: {},
      script: [],
      kpIndex: {},
    };
    if (exposeRemote) REMOTE_PRODUCT_IDS.add(item.id);
  });
}

export function getVisibleProductIds(account) {
  const out = [];
  const add = (id) => {
    if (id && PRODUCTS[id] && !out.includes(id)) out.push(id);
  };

  if (!VISIBILITY_STATE.assignmentsLoaded) {
    (account?.productIds || []).forEach(add);
    REMOTE_PRODUCT_IDS.forEach(add);
    return out;
  }

  // 若静态 mock 产品还没有对应后端课程，保留为本地演示兜底；一旦后端存在该课程，
  // 可见性以 /courses/by-account 返回的 active 分发为准。
  (account?.productIds || []).forEach((id) => {
    const p = PRODUCTS[id];
    if (p && !(p.meta && p.meta.backendId)) add(id);
  });
  ASSIGNED_PRODUCT_IDS.forEach(add);
  return out;
}

export async function loadLearnerAccounts() {
  try {
    const resp = await fetch(`${API_BASE}/api/course-learners`);
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.items || [];
    items.forEach(registerLearnerAccount);
    return items;
  } catch (e) {
    console.warn('[productCatalog] loadLearnerAccounts failed:', e);
    return [];
  }
}

export async function loadRemoteProducts(accountRef) {
  try {
    // 动态课程按账号分发；切换账号时先移除上一账号的动态课程缓存。
    Array.from(REMOTE_PRODUCT_IDS).forEach(id => {
      delete PRODUCTS[id];
    });
    REMOTE_PRODUCT_IDS.clear();
    ASSIGNED_PRODUCT_IDS.clear();
    VISIBILITY_STATE.assignmentsLoaded = false;

    // 始终拉全量 /api/courses 合并静态产品的后端元数据（backendId、coverImage 等）
    const allResp = await fetch(`${API_BASE}/api/courses`);
    if (allResp.ok) {
      const allData = await allResp.json();
      _mergeRemoteItems(allData.items || [], { exposeRemote: false });
    }
    await loadLearnerAccounts();

    // 有账号时额外拉分发列表，补充该账号专属的动态课程
    if (accountRef) {
      const accResp = await fetch(`${API_BASE}/api/courses/by-account/${encodeURIComponent(accountRef)}`);
      if (accResp.ok) {
        const accData = await accResp.json();
        if (accData.learner) registerLearnerAccount(accData.learner);
        else if (!ACCOUNT_INDEX[accountRef]) registerLearnerAccount(accountRef);
        const items = accData.items || [];
        items.forEach(item => ASSIGNED_PRODUCT_IDS.add(item.id));
        _mergeRemoteItems(items, { exposeRemote: true });
        VISIBILITY_STATE.assignmentsLoaded = true;
      }
    }

    return Object.keys(PRODUCTS);
  } catch (e) {
    console.warn('[productCatalog] loadRemoteProducts failed:', e);
    return [];
  }
}

export async function ensureProductLoaded(productId) {
  const existing = PRODUCTS[productId];
  if (existing && existing.knowledge) {
    // 静态产品已经有 knowledge 但可能还没合并后端富字段——backendId 有就拉一次（best-effort）
    if (existing.meta && existing.meta.backendId) {
      loadServerKpsInto(existing).then(() => {
        if (_activeProductId === existing.id) applyWindowData(existing);
      });
    }
    return existing;
  }
  if (!REMOTE_PRODUCT_IDS.has(productId) && !existing) {
    console.warn('[productCatalog] unknown product:', productId);
    return null;
  }
  const resp = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(productId)}`);
  if (!resp.ok) throw new Error(`fetch course ${productId} failed: HTTP ${resp.status}`);
  const data = await resp.json();
  const p = buildIndices({
    id: data.id,
    meta: data.meta,
    knowledge: data.knowledge || [],
    customer: data.customer,
    customers: data.customers && data.customers.length ? data.customers : [data.customer],
    script: data.script || [],
  });
  PRODUCTS[productId] = p;
  // 合并服务端 approved KP 富字段（best-effort，失败不影响主流程）
  await loadServerKpsInto(p);
  return p;
}

export async function setActiveProduct(productId) {
  let p = PRODUCTS[productId];
  if (!p || !p.knowledge) {
    p = await ensureProductLoaded(productId);
  }
  if (!p) {
    console.warn('[productCatalog] unknown product:', productId);
    return null;
  }
  _activeProductId = productId;
  applyWindowData(p);
  // 已 cache 的 product 也尝试刷一次服务端 KP（拿到最新 enrich 结果）
  if (p.meta && p.meta.backendId) {
    loadServerKpsInto(p).then(() => applyWindowData(p));
  }
  return p;
}

export function getActiveProductId() { return _activeProductId; }
export function getActiveProduct() { return _activeProductId ? PRODUCTS[_activeProductId] : null; }

// 初始化默认产品（静态注册，已带 knowledge），同步写入 window.SIMUGO_DATA。
// 不走 setActiveProduct（已改 async）以保证模块加载时立即可用。
_activeProductId = 'zeekr007';
applyWindowData(PRODUCTS.zeekr007);

// HMR：模块热更新后重新拉一次远端元数据（coverImage / backendId），
// 避免开发时 Vite 重建模块导致封面丢失。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    loadRemoteProducts().catch(() => {});
  });
}
