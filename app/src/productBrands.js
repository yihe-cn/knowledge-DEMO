// productBrands.js — 每个产品的视觉品牌：色板 / 图形
//
// 为什么独立成文件而不是塞进 productCatalog.meta：
// - meta 字段还要走后端（admin 端口创建产品），不希望让运营在创建产品时被迫填色码；
// - 品牌色是纯前端展示约定，跟知识点 / 客户没关系，归一在这里改色更顺手。
//
// 解析顺序：
//   1. 命中 BRANDS_BY_ID  → 用静态预设
//   2. 命中 BRANDS_BY_INDUSTRY → 按行业类别给一个稳定品牌
//   3. 退而求其次 → 用 productId 稳定 hash 落到 FALLBACK_POOL 上
//
// 任何 brand 对象都包含：
//   accent       主色（icon 底、按钮、进度条主色）
//   accentSoft   辅色（渐变末端 / 进度条尾色）
//   tint         极淡背景，用于 hero / 卡片底铺色
//   onAccent     accent 上的文字色（一般 #fff）
//   icon         fallback emoji / 字符（用于没指定 meta.industryIcon 时）

const BRAND_TEAL_MED   = { accent: '#3B7A6E', accentSoft: '#7FB3A4', tint: 'rgba(59,122,110,0.10)', onAccent: '#fff', icon: '🩺' };
const BRAND_ZEEKR_CYAN = { accent: '#2B6F7A', accentSoft: '#7DB8C4', tint: 'rgba(43,111,122,0.10)', onAccent: '#fff', icon: '🚗' };
const BRAND_PLUM       = { accent: '#5F4B8B', accentSoft: '#A893C8', tint: 'rgba(95,75,139,0.10)', onAccent: '#fff', icon: '◎' };
const BRAND_AMBER      = { accent: '#B8743A', accentSoft: '#E0A878', tint: 'rgba(184,116,58,0.10)', onAccent: '#fff', icon: '⬡' };
const BRAND_INDIGO     = { accent: '#3F4DB5', accentSoft: '#8693D8', tint: 'rgba(63,77,181,0.10)', onAccent: '#fff', icon: '◆' };
const BRAND_ROSE       = { accent: '#B5466A', accentSoft: '#E08AA0', tint: 'rgba(181,70,106,0.10)', onAccent: '#fff', icon: '✦' };
const BRAND_OLIVE      = { accent: '#6B8E3F', accentSoft: '#A8C078', tint: 'rgba(107,142,63,0.10)', onAccent: '#fff', icon: '✿' };

const BRANDS_BY_ID = {
  pax:       { ...BRAND_TEAL_MED, icon: '🍼' },
  zeekr007:  BRAND_ZEEKR_CYAN,
};

// 行业关键词 → 品牌；用 includes 是为了兼容"医药学术 / 学术拜访"这类不同写法
const BRANDS_BY_INDUSTRY = [
  { match: /医药|学术/, brand: { ...BRAND_TEAL_MED, icon: '🩺' } },
  { match: /汽车/,      brand: BRAND_ZEEKR_CYAN },
  { match: /企业培训/,   brand: { ...BRAND_AMBER, icon: '⬡' } },
  { match: /通用/,      brand: { ...BRAND_PLUM, icon: '◎' } },
];

const FALLBACK_POOL = [BRAND_INDIGO, BRAND_ROSE, BRAND_OLIVE, BRAND_PLUM, BRAND_AMBER];

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getProductBrand(productId, meta = {}) {
  if (productId && BRANDS_BY_ID[productId]) return BRANDS_BY_ID[productId];

  const industry = meta?.industry || '';
  for (const { match, brand } of BRANDS_BY_INDUSTRY) {
    if (match.test(industry)) return brand;
  }

  const id = productId || meta?.name || 'unknown';
  return FALLBACK_POOL[hashId(id) % FALLBACK_POOL.length];
}
