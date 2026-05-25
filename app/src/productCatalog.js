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

let _activeProductId = null;

export function setActiveProduct(productId) {
  const p = PRODUCTS[productId];
  if (!p) {
    console.warn('[productCatalog] unknown product:', productId);
    return;
  }
  _activeProductId = productId;
  if (typeof window !== 'undefined') {
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
}

export function getActiveProductId() { return _activeProductId; }
export function getActiveProduct() { return _activeProductId ? PRODUCTS[_activeProductId] : null; }

// 初始化默认产品，确保模块加载时 window.SIMUGO_DATA 立刻可用
setActiveProduct('zeekr007');
