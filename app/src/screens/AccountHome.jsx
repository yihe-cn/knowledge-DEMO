// AccountHome.jsx — 顶层"我的课程"页 + 账号切换
// 选择账号 → 切换演示场景上下文（学员身份、行业、可见课程）
// 选择课程卡片 → 进入该产品的"学练评"主页（home）

import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../components/Primitives.jsx';
import { ACCOUNTS, ACCOUNT_INDEX, PRODUCTS, REMOTE_PRODUCT_IDS } from '../productCatalog.js';
import { getProductBrand } from '../productBrands.js';

// 本屏专用的轻量卡片包装 — 不复用全局 Card（neuRaised 阴影偏厚），
// 也不污染 Primitives，避免其他屏体感被改。
function SoftCard({ t, style, onClick, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: t.surface,
        borderRadius: 18,
        border: `1px solid ${t.line}`,
        boxShadow: `0 1px 2px ${t.sDark}30, 0 12px 28px -16px ${t.sDark}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .15s ease, box-shadow .15s ease',
        ...style,
      }}
    >{children}</div>
  );
}

function emptyProgress() {
  return { learnedPoints: new Set(), practiced: false, reportReady: false, picks: [], finalMood: null };
}

// 把进度归并成一个稳定的语义，让卡片副标题与 hero 共用
function describeStage(product, progress) {
  const total = product.meta?.knowledgeTotal || 0;
  const learnedCount = progress.learnedPoints?.size || 0;
  const learnPct = total > 0 ? learnedCount / total : 0;
  let stage = 'idle';
  if (progress.reportReady) stage = 'done';
  else if (progress.practiced) stage = 'await-report';
  else if (learnPct >= 1)     stage = 'await-practice';
  else if (learnPct > 0)      stage = 'learning';
  return { stage, learnPct, learnedCount, total };
}

function stageLabel(d) {
  switch (d.stage) {
    case 'done':           return '已完成评估';
    case 'await-report':   return '待查看评估';
    case 'await-practice': return '已完成学习 · 待演练';
    case 'learning':       return `学习中 · ${Math.round(d.learnPct * 100)}%`;
    default:               return d.total ? `未开始 · ${d.total} 个知识点` : '未开始';
  }
}

function stageCTA(d) {
  switch (d.stage) {
    case 'done':           return '查看报告';
    case 'await-report':   return '查看本次评估';
    case 'await-practice': return '开始演练';
    case 'learning':       return '继续学习';
    default:               return '开始学习';
  }
}

// "今日推荐"挑选：优先有进度但未完成 > 学完待演练 > 演练完待评 > 默认第一个
function pickRecommended(ids, progressByProduct) {
  const ranked = ids
    .map(id => {
      const p = PRODUCTS[id];
      if (!p) return null;
      const d = describeStage(p, progressByProduct[id] || emptyProgress());
      let priority = 0;
      if (d.stage === 'learning')        priority = 4;
      else if (d.stage === 'await-practice') priority = 3;
      else if (d.stage === 'await-report')   priority = 2;
      else if (d.stage === 'idle')           priority = 1;
      // done → 0，不再推荐
      return { id, p, d, priority };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);
  return ranked[0] || null;
}

function AccountHome({ t, accountId, switchAccount, switchProduct, progressByProduct }) {
  const account = ACCOUNT_INDEX[accountId] || ACCOUNTS[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // 账号自带的静态产品在前，后端动态产品（admin 新建）追加在后
  const visibleIds = [
    ...account.productIds,
    ...Array.from(REMOTE_PRODUCT_IDS).filter(id => !account.productIds.includes(id)),
  ];

  const recommended = pickRecommended(visibleIds, progressByProduct);

  return (
    <div style={{ padding: '4px 18px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <BrandBar
        t={t}
        account={account}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        switchAccount={switchAccount}
        menuRef={menuRef}
      />

      <Greeting t={t} account={account} />

      {recommended && (
        <HeroCard
          t={t}
          product={recommended.p}
          desc={recommended.d}
          onClick={() => switchProduct(recommended.id)}
        />
      )}

      <div>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          padding: '0 2px 10px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: '0.01em' }}>
            全部课程
          </div>
          <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.08em', fontWeight: 600 }}>
            {visibleIds.length} 门
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleIds.map(pid => {
            const product = PRODUCTS[pid];
            if (!product) return null;
            const progress = progressByProduct[pid] || emptyProgress();
            return (
              <ProductCard
                key={pid}
                t={t}
                product={product}
                progress={progress}
                isRecommended={recommended?.id === pid}
                onClick={() => switchProduct(pid)}
              />
            );
          })}
          <PlaceholderCard t={t} />
        </div>
      </div>
    </div>
  );
}

// ─── 顶部品牌条：左 wordmark，右头像（含 popover）────────────────────
function BrandBar({ t, account, menuOpen, setMenuOpen, switchAccount, menuRef }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '2px 2px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{
          fontSize: 17, fontWeight: 800, color: t.text,
          letterSpacing: '0.04em',
        }}>SIMUGO</div>
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, letterSpacing: '0.16em' }}>
          学 · 练 · 评
        </div>
      </div>

      <div ref={menuRef} style={{ position: 'relative' }}>
        <div
          onClick={() => setMenuOpen(o => !o)}
          style={{ cursor: 'pointer', display: 'inline-flex' }}
        >
          <Avatar t={t} account={account} size={36} />
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            background: t.surface,
            borderRadius: 16,
            border: `1px solid ${t.line}`,
            boxShadow: `0 2px 6px ${t.sDark}40, 0 18px 42px -16px ${t.sDark}`,
            padding: 6,
            zIndex: 50,
            minWidth: 240,
          }}>
            <div style={{ padding: '12px 14px 8px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{account.name}</div>
              <div style={{ fontSize: 11.5, color: t.textSoft, marginTop: 2 }}>
                {account.role} · {account.org}
              </div>
            </div>
            <div style={{ height: 1, background: t.line, margin: '4px 8px 6px' }} />
            <div style={{
              padding: '4px 14px 6px', fontSize: 10, color: t.textMute,
              fontWeight: 700, letterSpacing: '0.12em',
            }}>切换演示账号</div>
            {ACCOUNTS.map(a => {
              const active = a.id === account.id;
              return (
                <div
                  key={a.id}
                  onClick={() => { switchAccount(a.id); setMenuOpen(false); }}
                  style={{
                    padding: '8px 10px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: active ? `${t.accent}14` : 'transparent',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = t.surface2; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Avatar t={t} account={a} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: t.textMute, marginTop: 1 }}>{a.role} · {a.orgShort}</div>
                  </div>
                  {active && <Icon name="check" size={14} color={t.accent} stroke={2.4} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Greeting({ t, account }) {
  const hour = new Date().getHours();
  const salute = hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return (
    <div style={{ padding: '4px 2px 0' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: t.text, letterSpacing: '-0.01em' }}>
        {salute}，{account.name}
      </div>
      <div style={{ fontSize: 12.5, color: t.textSoft, marginTop: 6, letterSpacing: '0.04em' }}>
        {account.orgShort}
      </div>
    </div>
  );
}

function Avatar({ t, account, size = 40 }) {
  const tones = {
    cyan:  { bg: '#3FA4A0', fg: '#fff' },
    sage:  { bg: '#6B8E6F', fg: '#fff' },
    warm:  { bg: '#B8743A', fg: '#fff' },
    gold:  { bg: '#C9A14F', fg: '#fff' },
    dark:  { bg: t.text,    fg: t.bg },
  };
  const tone = tones[account.avatarColor] || tones.cyan;
  return (
    <div style={{
      width: size, height: size, borderRadius: 12,
      background: tone.bg, color: tone.fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700,
      flexShrink: 0,
      boxShadow: `0 1px 2px rgba(0,0,0,0.12), 0 4px 10px -4px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.20)`,
    }}>{account.avatar}</div>
  );
}

// ─── Hero：今日推荐 ─────────────────────────────────────────────────
function HeroCard({ t, product, desc, onClick }) {
  const brand = getProductBrand(product.id, product.meta);
  const icon = product.meta?.industryIcon || brand.icon;

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 22,
        padding: '20px 20px 18px',
        background: brand.tint,
        border: `1px solid ${brand.accent}22`,
        boxShadow: `0 1px 2px ${t.sDark}30, 0 18px 42px -22px ${brand.accent}55`,
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* 装饰圆 */}
      <div style={{
        position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: '50%',
        background: `radial-gradient(circle, ${brand.accent}22 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        fontSize: 10, color: brand.accent, fontWeight: 800, letterSpacing: '0.16em',
      }}>今日推荐 · {desc.stage === 'idle' ? '从这里开始' : '继续上次'}</div>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: brand.accent, color: brand.onAccent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26,
          flexShrink: 0,
          boxShadow: `0 6px 14px -4px ${brand.accent}66, inset 0 1px 0 rgba(255,255,255,0.22)`,
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.text, letterSpacing: '-0.005em' }}>
            {product.meta?.name || product.id}
          </div>
          <div style={{ fontSize: 12.5, color: t.textSoft, marginTop: 4 }}>
            {stageLabel(desc)}
          </div>
        </div>
      </div>

      {desc.total > 0 && (
        <div style={{
          position: 'relative',
          marginTop: 14,
          height: 4,
          background: `${brand.accent}1a`,
          borderRadius: 999,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${Math.max(desc.learnPct * 100, desc.stage === 'idle' ? 0 : 4)}%`,
            background: `linear-gradient(90deg, ${brand.accent}, ${brand.accentSoft})`,
            transition: 'width .4s ease',
          }} />
        </div>
      )}

      <div style={{
        position: 'relative',
        marginTop: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
        color: brand.accent, fontSize: 13.5, fontWeight: 700,
      }}>
        {stageCTA(desc)}
        <Icon name="arrow" size={16} color={brand.accent} stroke={2.2} />
      </div>
    </div>
  );
}

// ─── 课程卡：brand 色驱动 ─────────────────────────────────────────────
function ProductCard({ t, product, progress, isRecommended, onClick }) {
  const brand = getProductBrand(product.id, product.meta);
  const icon = product.meta?.industryIcon || brand.icon;
  const desc = describeStage(product, progress);

  return (
    <SoftCard t={t} onClick={onClick} style={{
      padding: 16,
      // 当前推荐项淡淡描边，但 hero 已经更显眼，这里只留一抹
      ...(isRecommended ? { borderColor: `${brand.accent}55` } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: brand.accent,
          color: brand.onAccent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
          flexShrink: 0,
          boxShadow: `0 4px 10px -3px ${brand.accent}55, inset 0 1px 0 rgba(255,255,255,0.18)`,
        }}>{icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: t.text, letterSpacing: '-0.005em' }}>
              {product.meta?.name || product.id}
            </div>
            {product.meta?.industry && (
              <div style={{
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.08em',
                padding: '2px 7px', borderRadius: 4,
                background: brand.tint,
                color: brand.accent,
              }}>{product.meta.industry}</div>
            )}
          </div>
          <div style={{ fontSize: 12, color: t.textSoft, marginTop: 4 }}>{stageLabel(desc)}</div>
        </div>

        <Icon name="arrow" size={16} color={t.textMute} />
      </div>

      <div style={{
        marginTop: 12, height: 3,
        background: `${brand.accent}14`,
        borderRadius: 999,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${desc.learnPct * 100}%`,
          background: `linear-gradient(90deg, ${brand.accent}, ${brand.accentSoft})`,
          transition: 'width .4s ease',
        }} />
      </div>
    </SoftCard>
  );
}

function PlaceholderCard({ t }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 16,
      border: `1px dashed ${t.line}`,
      display: 'flex', alignItems: 'center', gap: 12,
      color: t.textMute,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 9,
        background: t.surface2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, color: t.textMute, fontWeight: 700,
      }}>+</div>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>更多行业场景陆续接入</div>
    </div>
  );
}

export { AccountHome };
