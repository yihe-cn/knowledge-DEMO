// screens.jsx — Home, Learning, Practice (chat), Report
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";
import { PRODUCTS, REMOTE_PRODUCT_IDS } from "../productCatalog.js";

// ═══ HOME ═════════════════════════════════════════════════════════
function HomeScreen({ t, state, go, account, product, onBackToAccounts, switchProduct }) {
  const learnTotal = product.meta.knowledgeTotal;
  const learnDone = state.learnedPoints.size;
  const learnPct = learnTotal > 0 ? learnDone / learnTotal : 0;
  const practiced = state.practiced;
  const reportReady = state.reportReady;

  // S4：下一步推荐——按闭环顺序找第一个未完成的环节作为高亮卡。
  // 全部完成时返回 null，三张卡都正常 done 态。
  const nextKind = !practiced && learnPct < 1 ? 'learn'
    : !practiced && learnPct >= 1 ? 'practice'
    : practiced && !reportReady ? 'report'
    : null;
  const nextCta = {
    learn: learnDone > 0 ? '继续学习 →' : '开始学习 →',
    practice: '开始实战演练 →',
    report: '查看本次评估 →',
  };

  return (
    <div style={{ padding: '4px 18px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Greeting */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: t.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600,
        }}>
          {onBackToAccounts && (
            <span
              onClick={onBackToAccounts}
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icon name="back" size={14} color={t.textMute} stroke={2} />
              <span>我的课程</span>
            </span>
          )}
          <span style={{ color: t.textMute, opacity: 0.5 }}>·</span>
          <span>{account.orgShort}</span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: t.text, marginTop: 6, letterSpacing: '-0.01em' }}>早上好，{account.name}</div>
        <div style={{ fontSize: 14, color: t.textSoft, marginTop: 6 }}>今日训练任务：{product.meta.name} 产品力 · 第 3 天</div>
        {switchProduct && (
          <div style={{ marginTop: 10 }}>
            <CourseSwitcher t={t} account={account} product={product} switchProduct={switchProduct} />
          </div>
        )}
      </div>

      {/* Closed-loop journey card */}
      <Card t={t} style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.accent, letterSpacing: '0.12em' }}>学 · 练 · 评 闭环</div>
          <div style={{ fontSize: 11, color: t.textMute }}>第 1 / 1 场</div>
        </div>
        <div style={{ marginTop: 16, position: 'relative' }}>
          <JourneyTrack t={t} learnPct={learnPct} practiced={practiced} reportReady={reportReady} />
        </div>
      </Card>

      {/* AI 答疑 + 我的笔记 — 随时辅助（不在闭环里，作为旁支） */}
      <AIAssistantBanner t={t} onClick={() => go('aiqa')} onOpenNotes={() => go('notes')} />

      {/* 学 — Learning */}
      <ModuleEntry
        t={t}
        kind="learn"
        title="学习课程"
        sub={`${product.meta.name} · ${learnDone}/${learnTotal} 个知识点已学完`}
        progress={learnPct}
        status={learnPct >= 1 ? 'done' : 'active'}
        icon="book"
        isNext={nextKind === 'learn'}
        nextCta={nextCta.learn}
        onClick={() => go('learn')}
      />

      {/* 练 — Practice */}
      <ModuleEntry
        t={t}
        kind="practice"
        title="场景演练"
        sub={product.meta.practiceSummary}
        progress={practiced ? 1 : 0}
        status={learnPct < 1 ? 'locked' : practiced ? 'done' : 'active'}
        icon="chat"
        lockHint={learnPct < 1 ? '完成全部知识点后解锁' : null}
        isNext={nextKind === 'practice'}
        nextCta={nextCta.practice}
        onClick={() => learnPct >= 1 && go('practice')}
      />

      {/* 评 — Report */}
      <ModuleEntry
        t={t}
        kind="report"
        title="能力评估报告"
        sub={reportReady ? '点击查看本次评估' : '演练完成后生成'}
        progress={reportReady ? 1 : 0}
        status={!practiced ? 'locked' : reportReady ? 'done' : 'active'}
        icon="chart"
        lockHint={!practiced ? '完成演练后生成' : null}
        isNext={nextKind === 'report'}
        nextCta={nextCta.report}
        onClick={() => reportReady && go('report')}
      />
    </div>
  );
}

// 课程切换器（S2）：演示中途切产品不必返回 accounts 页。
// 列出 当前账号静态可见产品 ∪ 远端动态产品，已加载/未加载都允许进入——
// 未加载的会走 switchProduct 内的 ensureProductLoaded 异步加载。
function CourseSwitcher({ t, account, product, switchProduct }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // 每次渲染都重算——REMOTE_PRODUCT_IDS 是模块级 Set，loadRemoteProducts
  // 异步填充后没有 reactive 信号；ids 列表很短，无须 memo。
  const ids = [...(account.productIds || [])];
  REMOTE_PRODUCT_IDS.forEach(id => { if (!ids.includes(id)) ids.push(id); });
  const visibleIds = ids;

  if (visibleIds.length <= 1) return null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          ...neuFlat(t, 999), padding: '6px 12px 6px 8px',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14 }}>{product.meta.industryIcon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>{product.meta.name}</span>
        <span style={{
          transform: `rotate(${open ? 180 : 0}deg)`,
          transition: 'transform .2s',
          color: t.textMute,
          fontSize: 11, lineHeight: 1,
        }}>▾</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          ...neuRaised(t, 14, 1.2),
          padding: 6,
          zIndex: 50,
          minWidth: 240,
        }}>
          <div style={{
            padding: '8px 12px 6px', fontSize: 10, color: t.textMute,
            fontWeight: 700, letterSpacing: '0.12em',
          }}>切换课程</div>
          {visibleIds.map(pid => {
            const p = PRODUCTS[pid];
            if (!p) return null;
            const active = pid === product.id;
            return (
              <div
                key={pid}
                onClick={() => {
                  setOpen(false);
                  if (!active) switchProduct(pid);
                }}
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
                <div style={{
                  width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                  background: t.surface2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15,
                  boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
                }}>{p.meta.industryIcon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{p.meta.name}</div>
                  <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 1 }}>{p.meta.industry}</div>
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

function JourneyTrack({ t, learnPct, practiced, reportReady }) {
  // 3 nodes connected by line; current = next undone
  const nodes = [
    { label: '学', done: learnPct >= 1, active: learnPct < 1 },
    { label: '练', done: practiced, active: learnPct >= 1 && !practiced },
    { label: '评', done: reportReady, active: practiced && !reportReady },
  ];
  const filledTo = nodes.findIndex(n => !n.done);
  const fillPct = filledTo === -1 ? 1 : filledTo / (nodes.length - 1);
  return (
    <div style={{ position: 'relative', height: 64 }}>
      {/* track */}
      <div style={{ position: 'absolute', left: 28, right: 28, top: 22, height: 8, ...neuInset(t, 999, 0.5) }} />
      <div style={{
        position: 'absolute', left: 28, top: 22, height: 8, borderRadius: 999,
        width: `calc((100% - 56px) * ${fillPct})`,
        background: `linear-gradient(90deg, ${t.accent}, ${t.accentSoft})`,
        transition: 'width .4s ease',
        boxShadow: `0 2px 6px ${t.sDark}`,
      }} />
      {/* nodes */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'space-between' }}>
        {nodes.map((n, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 999,
              ...(n.done ? { background: t.accent, color: '#fff', boxShadow: `4px 4px 8px ${t.sDark}, -3px -3px 6px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.2)` }
                : n.active ? { background: t.surface, color: t.accent, boxShadow: `4px 4px 8px ${t.sDark}, -3px -3px 6px ${t.sLight}, 0 0 0 2px ${t.accent} inset` }
                : { ...neuInset(t, 999, 0.6), color: t.textMute }),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700,
              transition: 'all .25s',
            }}>
              {n.done ? <Icon name="check" size={22} color="#fff" stroke={2.2} /> : n.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModuleEntry({ t, kind, title, sub, progress, status, icon, lockHint, isNext, nextCta, onClick }) {
  const locked = status === 'locked';
  const done = status === 'done';
  return (
    <Card t={t} onClick={locked ? undefined : onClick} style={{
      padding: 18, opacity: locked ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 16,
      // S4：当前推荐项加 accent ring + 微微发光，无障碍提示"现在做这个"
      ...(isNext ? {
        boxShadow: `4px 4px 12px ${t.sDark}, -3px -3px 8px ${t.sLight}, 0 0 0 2px ${t.accent} inset, 0 0 0 5px ${t.accent}1a`,
      } : {}),
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 18, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...(done ? { background: t.accent, color: '#fff', boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2)` } :
            locked ? neuInset(t, 18, 0.6) :
            { background: t.surface2, color: t.accent, boxShadow: `2px 2px 5px ${t.sDark}, -2px -2px 5px ${t.sLight}` }),
      }}>
        <Icon name={locked ? 'lock' : icon} size={24} color={done ? '#fff' : locked ? t.textMute : t.accent} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>{title}</div>
          {done && <div style={{ fontSize: 11, color: t.good, fontWeight: 600 }}>● 已完成</div>}
          {isNext && (
            <div style={{
              fontSize: 10, color: '#fff', fontWeight: 700, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 999,
              background: t.accent,
              boxShadow: `1px 1px 2px ${t.sDark}`,
            }}>NEXT</div>
          )}
        </div>
        <div style={{
          fontSize: 13, marginTop: 4,
          color: isNext ? t.accent : t.textSoft,
          fontWeight: isNext ? 700 : 400,
        }}>{lockHint || (isNext && nextCta ? nextCta : sub)}</div>
        {!locked && (
          <div style={{ marginTop: 10, height: 5, ...neuInset(t, 999, 0.4), position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`,
              background: `linear-gradient(90deg, ${t.accent}, ${t.accentSoft})`,
              transition: 'width .4s ease',
            }} />
          </div>
        )}
      </div>
      {!locked && <Icon name="arrow" size={18} color={isNext ? t.accent : t.textMute} stroke={isNext ? 2.2 : 1.6} />}
    </Card>
  );
}

// ═══ LEARNING ═══════════════════════════════════════════════════════
function LearningScreen({ t, state, setState, go, product, highlight }) {
  const KNOWLEDGE = product ? product.knowledge : window.SIMUGO_DATA.KNOWLEDGE;
  const productName = product ? product.meta.name : (window.SIMUGO_DATA.PRODUCT?.meta?.name || '');
  const totalKp = product ? product.meta.knowledgeTotal : KNOWLEDGE.reduce((a, m) => a + m.points.length, 0);
  const hasKnowledge = Array.isArray(KNOWLEDGE) && KNOWLEDGE.length > 0;
  const initialMod = useMemo(() => {
    if (!hasKnowledge) return null;
    if (!highlight) return KNOWLEDGE[0].id;
    return KNOWLEDGE.find(m => m.points.some(p => p.id === highlight))?.id || KNOWLEDGE[0].id;
  }, [KNOWLEDGE, highlight, hasKnowledge]);
  const [openMod, setOpenMod] = useState(initialMod);
  const highlightRef = useRef(null);

  useEffect(() => {
    if (!highlight) return;
    setOpenMod(initialMod);
  }, [highlight, initialMod]);

  useEffect(() => {
    if (!highlight || !highlightRef.current) return;
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
    return () => clearTimeout(timer);
  }, [highlight, openMod]);

  const togglePoint = (pid) => {
    setState(s => {
      const next = new Set(s.learnedPoints);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return { ...s, learnedPoints: next };
    });
  };

  if (!hasKnowledge) {
    return (
      <div style={{ padding: '4px 18px 18px' }}>
        <TopBar t={t} title={`学习课程 · ${productName}`} onBack={() => go('home')} />
        <div style={{
          marginTop: 24,
          padding: '32px 20px',
          textAlign: 'center',
          borderRadius: 18,
          border: `1px dashed ${t.line}`,
          color: t.textMute,
          fontSize: 14,
          lineHeight: 1.7,
        }}>
          该产品尚未配置知识点。<br />
          请在管理后台为产品添加并审核 KP 后再回来。
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 18px 18px' }}>
      <TopBar t={t} title={`学习课程 · ${productName}`} onBack={() => go('home')} />
      <div style={{ fontSize: 13, color: t.textSoft, padding: '0 4px 14px', lineHeight: 1.55 }}>
        每个知识点包含产品参数与<b style={{ color: t.accent }}>销售应用提示</b>——告诉你这个知识点在客户对话中怎么用。
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {KNOWLEDGE.map(mod => {
          const learned = mod.points.filter(p => state.learnedPoints.has(p.id)).length;
          const total = mod.points.length;
          const expanded = openMod === mod.id;
          return (
            <Card key={mod.id} t={t} style={{ overflow: 'hidden' }}>
              <div onClick={() => setOpenMod(expanded ? null : mod.id)} style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: t.surface2, color: t.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 700,
                  boxShadow: `2px 2px 5px ${t.sDark}, -2px -2px 5px ${t.sLight}`,
                }}>{mod.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{mod.title}</div>
                  <div style={{ fontSize: 12, color: t.textSoft, marginTop: 3 }}>{mod.summary}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600 }}>{learned}/{total}</div>
                  <div style={{ marginTop: 4, transform: `rotate(${expanded ? 90 : 0}deg)`, transition: 'transform .25s' }}>
                    <Icon name="arrow" size={16} color={t.textMute} />
                  </div>
                </div>
              </div>
              {expanded && (
                <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {mod.points.map(p => {
                    const learned = state.learnedPoints.has(p.id);
                    const isHighlighted = highlight === p.id;
                    return (
                      <div
                        key={p.id}
                        ref={isHighlighted ? highlightRef : null}
                        style={{
                          ...neuFlat(t, 16),
                          padding: 14,
                          outline: isHighlighted ? `2px solid ${t.accent}` : 'none',
                          animation: isHighlighted ? 'kpHighlightPulse 1.8s ease 0.3s 2' : 'none',
                        }}
                      >
                        {isHighlighted && (
                          <style>{`@keyframes kpHighlightPulse{0%,100%{box-shadow:2px 2px 5px ${t.sDark},-2px -2px 5px ${t.sLight}}50%{box-shadow:0 0 0 3px ${t.accent}55,2px 2px 10px ${t.sDark}}}`}</style>
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{p.title}</div>
                            <div style={{ fontSize: 13, color: t.textSoft, marginTop: 6, lineHeight: 1.6 }}>{p.spec}</div>
                            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: `linear-gradient(135deg, ${t.accent}12, ${t.accentSoft}12)`, borderLeft: `3px solid ${t.accent}` }}>
                              <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>销售应用提示</div>
                              <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>{p.sales}</div>
                            </div>
                          </div>
                        </div>
                        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div onClick={() => togglePoint(p.id)} style={{
                            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                            padding: '8px 12px', borderRadius: 999,
                            background: learned ? `${t.good}15` : t.surface2,
                            boxShadow: learned ? 'none' : `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`,
                          }}>
                            <div style={{
                              width: 18, height: 18, borderRadius: 999,
                              background: learned ? t.good : 'transparent',
                              border: learned ? 'none' : `1.5px solid ${t.textMute}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {learned && <Icon name="check" size={12} color="#fff" stroke={2.5} />}
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600, color: learned ? t.good : t.textSoft }}>
                              {learned ? '已学完' : '标记已学完'}
                            </span>
                          </div>
                          <div onClick={(e) => { e.stopPropagation(); go('aiqa', { kpId: p.id }); }} style={{
                            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            padding: '8px 12px', borderRadius: 999,
                            background: `linear-gradient(135deg, ${t.accent}18, ${t.accentSoft}12)`,
                            boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
                          }}>
                            <Icon name="sparkle" size={12} color={t.accent} stroke={2} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: t.accent }}>问 AI</span>
                          </div>
                          <div onClick={(e) => { e.stopPropagation(); go('aiqa', { kpId: p.id, mode: 'quiz' }); }} style={{
                            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            padding: '8px 12px', borderRadius: 999,
                            background: `linear-gradient(135deg, ${t.warn}18, ${t.bad}12)`,
                            boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
                          }}>
                            <Icon name="bolt" size={12} color={t.warn} stroke={2} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: t.warn }}>考考我</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Sticky bottom CTA */}
      <BottomCTA t={t}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: t.textSoft }}>已学完</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.text }}>{state.learnedPoints.size} / {totalKp} 个知识点</div>
          </div>
          <PillButton t={t} primary disabled={state.learnedPoints.size < totalKp} onClick={() => go('practice')}>
            {state.learnedPoints.size < totalKp ? '完成全部以解锁演练' : '进入演练 →'}
          </PillButton>
        </div>
      </BottomCTA>
    </div>
  );
}

function AIAssistantBanner({ t, onClick, onOpenNotes }) {
  const notesCount = window.useNotesCount ? window.useNotesCount() : 0;
  return (
    <div>
      <div onClick={onClick} style={{
        ...neuFlat(t, 18), padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
        background: `linear-gradient(135deg, ${t.surface} 0%, ${t.surface2} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* 背景装饰 */}
        <div style={{
          position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: '50%',
          background: `radial-gradient(circle, ${t.accent}14 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          width: 44, height: 44, borderRadius: 14, flexShrink: 0,
          background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `3px 3px 7px ${t.sDark}, -2px -2px 5px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.2)`,
          position: 'relative',
        }}>
          <Icon name="sparkle" size={20} color="#fff" stroke={2} />
          <div style={{
            position: 'absolute', top: -3, right: -3, width: 12, height: 12, borderRadius: 999,
            background: t.good, border: `2.5px solid ${t.bg}`,
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>问 AI · 产品私教</div>
            <div style={{
              padding: '1px 6px', borderRadius: 6, fontSize: 9, fontWeight: 700,
              background: t.accent, color: '#fff', letterSpacing: '0.05em',
            }}>NEW</div>
          </div>
          <div style={{ fontSize: 12, color: t.textSoft, marginTop: 3, lineHeight: 1.45 }}>
            学习卡壳了？想清楚怎么回客户？随时问我
          </div>
        </div>
        <Icon name="arrow" size={16} color={t.textMute} />
      </div>

      {/* 我的笔记 — 次级入口 */}
      <div onClick={onOpenNotes} style={{
        marginTop: 8, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer',
        borderRadius: 14,
        background: 'transparent',
        border: `1px dashed ${t.line}`,
        transition: 'all .15s ease',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.borderColor = 'transparent'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = t.line; }}
      >
        <div style={{ fontSize: 16 }}>📔</div>
        <div style={{ flex: 1, fontSize: 12.5, color: t.textSoft, fontWeight: 600 }}>
          我的笔记 {notesCount > 0 && <span style={{ color: t.accent }}>· {notesCount} 条记录</span>}
          {notesCount === 0 && <span style={{ color: t.textMute, fontWeight: 500 }}> · 答疑和突击会自动留存</span>}
        </div>
        <Icon name="arrow" size={13} color={t.textMute} />
      </div>
    </div>
  );
}

function BottomCTA({ t, children }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, left: 0, right: 0,
      marginTop: 24,
      marginLeft: -18, marginRight: -18,   // counter the page's 18px horizontal padding
      padding: '20px 18px 18px',
      background: `linear-gradient(180deg, ${t.bg}00 0%, ${t.bg} 35%)`,
      pointerEvents: 'none',                // let the fade not block taps
      zIndex: 5,
    }}>
      <div style={{ ...neuRaised(t, 22, 1.2), padding: '14px 16px', pointerEvents: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

export { HomeScreen, LearningScreen, BottomCTA };
