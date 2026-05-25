// AccountHome.jsx — 顶层"我的课程"页 + 账号切换
// 选择账号 → 切换演示场景上下文（学员身份、行业、可见课程）
// 选择课程卡片 → 进入该产品的"学练评"主页（home）

import React, { useState, useEffect, useRef } from 'react';
import { neuRaised, neuInset, neuFlat } from '../theme.js';
import { Card, Icon } from '../components/Primitives.jsx';
import { ACCOUNTS, ACCOUNT_INDEX, PRODUCTS } from '../productCatalog.js';

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

  return (
    <div style={{ padding: '4px 18px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <AccountSwitcher
        t={t}
        account={account}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        switchAccount={switchAccount}
        menuRef={menuRef}
      />

      <div>
        <div style={{ fontSize: 12, color: t.textMute, letterSpacing: '0.12em', fontWeight: 700 }}>
          我的课程 · {account.productIds.length} 门
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: t.text, marginTop: 6, letterSpacing: '-0.01em' }}>
          选择今天要演练的产品
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {account.productIds.map(pid => {
          const product = PRODUCTS[pid];
          const progress = progressByProduct[pid] || emptyProgress();
          return (
            <ProductCard
              key={pid}
              t={t}
              product={product}
              progress={progress}
              onClick={() => switchProduct(pid)}
            />
          );
        })}

        <PlaceholderCard t={t} />
      </div>
    </div>
  );
}

function AccountSwitcher({ t, account, menuOpen, setMenuOpen, switchAccount, menuRef }) {
  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <div
        onClick={() => setMenuOpen(o => !o)}
        style={{
          ...neuFlat(t, 18),
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer',
        }}
      >
        <Avatar t={t} account={account} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{account.name}</div>
          <div style={{ fontSize: 12, color: t.textSoft, marginTop: 2 }}>
            {account.role} · {account.org}
          </div>
        </div>
        <div style={{
          transform: `rotate(${menuOpen ? 180 : 0}deg)`,
          transition: 'transform .2s',
          color: t.textMute,
          fontSize: 14,
        }}>▾</div>
      </div>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          ...neuRaised(t, 16, 1.2),
          padding: 6,
          zIndex: 50,
        }}>
          <div style={{
            padding: '8px 12px 6px', fontSize: 10, color: t.textMute,
            fontWeight: 700, letterSpacing: '0.12em',
          }}>切换演示账号</div>
          {ACCOUNTS.map(a => {
            const active = a.id === account.id;
            return (
              <div
                key={a.id}
                onClick={() => { switchAccount(a.id); setMenuOpen(false); }}
                style={{
                  padding: '10px 12px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: active ? `${t.accent}14` : 'transparent',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = t.surface2; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <Avatar t={t} account={a} size={32} />
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
      boxShadow: `2px 2px 5px ${t.sDark}, -2px -2px 5px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)`,
    }}>{account.avatar}</div>
  );
}

function ProductCard({ t, product, progress, onClick }) {
  const { meta } = product;
  const learnPct = progress.learnedPoints.size / meta.knowledgeTotal;
  const stageLabel = (() => {
    if (progress.reportReady) return '已完成评估';
    if (progress.practiced)   return '待查看评估';
    if (learnPct >= 1)        return '已完成学习 · 待演练';
    if (learnPct > 0)         return `学习中 · ${Math.round(learnPct * 100)}%`;
    return '未开始';
  })();

  return (
    <Card t={t} onClick={onClick} style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 54, height: 54, borderRadius: 16,
          background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26,
          flexShrink: 0,
          boxShadow: `3px 3px 7px ${t.sDark}, -2px -2px 5px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.2)`,
        }}>{meta.industryIcon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>{meta.name}</div>
            <div style={{
              fontSize: 10, color: t.textMute, fontWeight: 700,
              letterSpacing: '0.08em',
              padding: '2px 6px', borderRadius: 4,
              background: t.surface2,
            }}>{meta.industry}</div>
          </div>
          <div style={{ fontSize: 12, color: t.textSoft, marginTop: 5 }}>{stageLabel}</div>
        </div>

        <Icon name="arrow" size={18} color={t.textMute} />
      </div>

      <div style={{ marginTop: 14, height: 5, ...neuInset(t, 999, 0.4), position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${learnPct * 100}%`,
          background: `linear-gradient(90deg, ${t.accent}, ${t.accentSoft})`,
          transition: 'width .4s ease',
        }} />
      </div>
    </Card>
  );
}

function PlaceholderCard({ t }) {
  return (
    <div style={{
      padding: '18px',
      borderRadius: 18,
      border: `1px dashed ${t.line}`,
      display: 'flex', alignItems: 'center', gap: 12,
      color: t.textMute,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12,
        background: t.surface2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, color: t.textMute, fontWeight: 700,
      }}>+</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>更多行业场景陆续接入</div>
    </div>
  );
}

function emptyProgress() {
  return { learnedPoints: new Set(), practiced: false, reportReady: false, picks: [], finalMood: null };
}

export { AccountHome };
