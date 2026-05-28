// AccountHome.jsx — 顶层"我的课程"页 + 账号切换
// 选择账号 → 切换演示场景上下文（学员身份、行业、可见课程）
// 选择课程卡片 → 进入该产品的"学练评"主页（home）

import React, { useState, useEffect, useRef } from 'react';
import { Card, Icon } from '../components/Primitives.jsx';
import { neuInset, neuRaised } from '../theme.js';
import { ACCOUNTS, PRODUCTS, getAccount, getVisibleProductIds } from '../productCatalog.js';
import { getProductBrand } from '../productBrands.js';
import { listByAccount } from '../lib/assessmentClient.js';

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

function AccountHome({ t, accountId, switchAccount, switchProduct, progressByProduct, go, onLogout }) {
  const account = getAccount(accountId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const visibleIds = getVisibleProductIds(account);

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
        onLogout={onLogout}
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

      <MyAssessmentsSection t={t} accountId={account.id} go={go} />

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
function BrandBar({ t, account, menuOpen, setMenuOpen, switchAccount, menuRef, onLogout }) {
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
            {onLogout && (
              <>
                <div style={{ height: 1, background: t.line, margin: '6px 8px' }} />
                <div
                  onClick={() => { setMenuOpen(false); onLogout(); }}
                  style={{
                    padding: '9px 10px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    borderRadius: 10,
                    cursor: 'pointer',
                    color: t.bad,
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${t.bad}10`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon name="logout" size={16} color={t.bad} stroke={2.1} />
                  <div style={{ fontSize: 13, fontWeight: 700 }}>退出登录</div>
                </div>
              </>
            )}
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

// ─── 三步节点进度条（学/练/评）──────────────────────────────────────
function ThreeStepTrack({ t, brand, stage }) {
  const learnDone = !['idle', 'learning'].includes(stage);
  const practiceDone = ['await-report', 'done'].includes(stage);
  const reportDone = stage === 'done';
  const steps = [
    { label: '学', done: learnDone },
    { label: '练', done: practiceDone },
    { label: '评', done: reportDone },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 14 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700,
              background: s.done ? brand.accent : 'transparent',
              color: s.done ? brand.onAccent : t.textMute,
              border: s.done ? 'none' : `1.5px solid ${t.line}`,
              transition: 'all .3s ease',
            }}>
              {s.done ? '✓' : i + 1}
            </div>
            <div style={{
              fontSize: 10, fontWeight: s.done ? 700 : 400,
              color: s.done ? brand.accent : t.textMute,
            }}>{s.label}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1, height: 2, marginBottom: 14,
              background: steps[i + 1].done || s.done ? brand.accent : t.line,
              transition: 'background .3s ease',
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── 课程封面：有图用图，无图用品牌渐变 CSS 封面 ───────────────────────
function CourseCover({ product, brand, height }) {
  const [imgError, setImgError] = React.useState(false);
  const coverUrl = product.meta?.coverImage;
  const showImg = coverUrl && !imgError;
  const decorText = product.meta?.shortName || (product.meta?.name || '').slice(0, 3) || '';

  if (showImg) {
    return (
      <img
        src={coverUrl}
        onError={() => setImgError(true)}
        alt={product.meta?.name}
        style={{ width: '100%', height, objectFit: 'cover', display: 'block' }}
      />
    );
  }

  return (
    <div style={{
      width: '100%', height,
      background: `linear-gradient(135deg, ${brand.accent} 0%, ${brand.accentSoft} 100%)`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* 右下角装饰大字 */}
      <div style={{
        position: 'absolute', right: -6, bottom: -14,
        fontSize: height * 0.75, fontWeight: 900, color: '#fff',
        opacity: 0.13, lineHeight: 1, letterSpacing: '-0.03em',
        userSelect: 'none', pointerEvents: 'none',
      }}>{decorText}</div>
      {/* 左下角：行业标签 + 课程名 */}
      <div style={{
        position: 'absolute', bottom: 14, left: 16,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {product.meta?.industry && (
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.7)',
            textTransform: 'uppercase',
          }}>{product.meta.industry}</div>
        )}
        <div style={{
          fontSize: 20, fontWeight: 800, color: '#fff',
          letterSpacing: '-0.01em', textShadow: '0 1px 6px rgba(0,0,0,0.18)',
        }}>{product.meta?.name || product.id}</div>
      </div>
    </div>
  );
}

// ─── Hero：今日推荐 ─────────────────────────────────────────────────
function HeroCard({ t, product, desc, onClick }) {
  const brand = getProductBrand(product.id, product.meta);
  const hasCover = !!product.meta?.coverImage;

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 22,
        background: t.surface,
        boxShadow: `4px 4px 12px ${t.sDark}, -3px -3px 8px ${t.sLight}, 0 18px 42px -22px ${brand.accent}55`,
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* 封面区：图片叠加芯片 + 底部渐变 */}
      <div style={{ position: 'relative' }}>
        <CourseCover product={product} brand={brand} height={hasCover ? 160 : 130} />

        {/* "今日推荐"芯片浮在封面左上角 */}
        <div style={{
          position: 'absolute', top: 12, left: 14,
          padding: '4px 10px',
          borderRadius: 20,
          background: hasCover ? 'rgba(0,0,0,0.30)' : `${brand.accent}22`,
          backdropFilter: hasCover ? 'blur(6px)' : 'none',
          fontSize: 10,
          color: hasCover ? 'rgba(255,255,255,0.92)' : brand.accent,
          fontWeight: 800, letterSpacing: '0.14em',
        }}>
          今日推荐 · {desc.stage === 'idle' ? '从这里开始' : '继续上次'}
        </div>

        {/* 真实图片时底部加渐变淡出，消除图文硬切 */}
        {hasCover && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 52,
            background: `linear-gradient(to bottom, transparent, ${t.surface})`,
            pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* 底部信息区 */}
      <div style={{ padding: `${hasCover ? 2 : 14}px 16px 16px` }}>
        <div style={{ fontSize: 12.5, color: t.textSoft }}>
          {stageLabel(desc)}
        </div>

        <ThreeStepTrack t={t} brand={brand} stage={desc.stage} />

        <div style={{
          marginTop: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
          color: brand.accent, fontSize: 13.5, fontWeight: 700,
        }}>
          {stageCTA(desc)}
          <Icon name="arrow" size={16} color={brand.accent} stroke={2.2} />
        </div>
      </div>
    </div>
  );
}

// ─── 课程卡：品牌封面 + 进度 ─────────────────────────────────────────
function ProductCard({ t, product, progress, isRecommended, onClick }) {
  const brand = getProductBrand(product.id, product.meta);
  const desc = describeStage(product, progress);

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 22,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: isRecommended
          ? `4px 4px 12px ${t.sDark}, -3px -3px 8px ${t.sLight}, 0 0 0 2px ${brand.accent}88 inset`
          : `3px 3px 8px ${t.sDark}, -2px -2px 6px ${t.sLight}`,
        background: t.surface,
      }}
    >
      {/* 封面 */}
      <CourseCover product={product} brand={brand} height={110} />

      {/* 信息区 */}
      <div style={{ padding: '12px 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, color: t.textSoft }}>{stageLabel(desc)}</div>
          <Icon name="arrow" size={15} color={t.textMute} />
        </div>
        <ThreeStepTrack t={t} brand={brand} stage={desc.stage} />
      </div>
    </div>
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

// ─── 我的考核任务（跨产品）─────────────────────────────────────────────
// 按 status 排序：pending / in_progress 在前，终态任务收纳到历史区。
// 空列表整段不显示，避免空状态噪音。
const STATUS_ORDER = { pending: 0, in_progress: 1, submitted: 2, graded: 3, stopped: 4 };
const STATUS_LABEL = {
  pending: '待开始',
  in_progress: '进行中',
  submitted: '已提交 · 待评',
  graded: '已完成',
  stopped: '已停止',
};
const ARCHIVED_ASSESSMENT_STATUSES = new Set(['graded', 'stopped']);

function isArchivedAssessment(item) {
  return ARCHIVED_ASSESSMENT_STATUSES.has(item.status);
}

function MyAssessmentsSection({ t, accountId, go }) {
  const [items, setItems] = useState(null); // null=未加载, [] = 加载完空
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    listByAccount(accountId)
      .then(list => { if (alive) setItems(list); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [accountId]);

  if (!items || items.length === 0) return null;

  const sorted = [...items].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
  );
  const activeItems = sorted.filter(it => !isArchivedAssessment(it));
  const archivedItems = sorted.filter(isArchivedAssessment);
  const archivedDone = archivedItems.filter(it => it.status === 'graded').length;
  const archivedStopped = archivedItems.filter(it => it.status === 'stopped').length;

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        padding: '0 2px 10px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: '0.01em' }}>
          我的考核任务
        </div>
        <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.08em', fontWeight: 600 }}>
          {activeItems.length} 待处理
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {activeItems.map(it => (
          <AssessmentRow key={it.assignment_id} t={t} item={it} onOpen={() => go && go('assessment', { token: it.token })} />
        ))}
        {archivedItems.length > 0 && (
          <div>
            <Card
              t={t}
              onClick={() => setHistoryOpen(v => !v)}
              style={{ padding: '12px 14px', opacity: 0.9 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: t.text }}>已收纳考核</div>
                  <div style={{ fontSize: 11.5, color: t.textMute, marginTop: 3 }}>
                    {archivedItems.length} 份
                    {archivedDone > 0 && ` · 已完成 ${archivedDone}`}
                    {archivedStopped > 0 && ` · 已停止 ${archivedStopped}`}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: t.textMute, fontWeight: 700 }}>
                  {historyOpen ? '收起' : '展开'}
                </div>
              </div>
            </Card>
            {historyOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {archivedItems.map(it => (
                  <AssessmentRow
                    key={it.assignment_id}
                    t={t}
                    item={it}
                    archived
                    onOpen={() => go && go('assessment', { token: it.token })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AssessmentRow({ t, item, onOpen, archived = false }) {
  const { template, status, score } = item;
  const isGraded = status === 'graded';
  const isStopped = status === 'stopped';
  const isOral = template.mode === 'ai_oral';
  const accent = isGraded
    ? (score != null && score >= template.pass_score ? '#2a8a3e' : '#a4571f')
    : isStopped
      ? t.textMute
    : t.accent;

  return (
    <Card t={t} onClick={onOpen} style={{ padding: archived ? 12 : 14, opacity: archived ? 0.82 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: archived ? 34 : 42, height: archived ? 34 : 42, borderRadius: archived ? 10 : 12,
          background: accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: archived ? 15 : 18, flexShrink: 0,
          boxShadow: `0 4px 10px -3px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.18)`,
        }}>
          {isOral ? '面' : '题'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: t.text }}>{template.title}</div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: `${accent}14`, color: accent,
            }}>
              {isOral ? 'AI 主考' : '题库'}
            </div>
            {archived && (
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                padding: '2px 7px', borderRadius: 4,
                background: `${accent}18`, color: accent,
              }}>
                {STATUS_LABEL[status] || status}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: t.textSoft, marginTop: 4 }}>
            {STATUS_LABEL[status] || status}
            {' · '}{isOral ? `约 ${template.num_questions} 轮` : `${template.num_questions} 题`}
            {isGraded && score != null && ` · 得分 ${score.toFixed(1)} / 及格 ${template.pass_score}`}
          </div>
          {isOral && !isGraded && !isStopped && (
            <div style={{ fontSize: 11.5, color: t.textMute, marginTop: 5, lineHeight: 1.4 }}>
              AI 逐轮提问 · 每轮即时评分 · 交卷后生成综合评价
            </div>
          )}
        </div>
        {!archived && <Icon name="arrow" size={16} color={t.textMute} />}
      </div>
    </Card>
  );
}

export { AccountHome };
