// screens.jsx — Home, Learning, Practice (chat), Report
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";
import { PRODUCTS, getVisibleProductIds } from "../productCatalog.js";
import { listByAccount } from "../lib/assessmentClient.js";
import { listCards as fetchLearningCards, submitAnswer as submitLearningAnswer, skipKp as skipLearningKp } from "../lib/learningClient.js";

// ═══ HOME ═════════════════════════════════════════════════════════
function HomeScreen({ t, state, setState, go, account, product, onBackToAccounts, switchProduct }) {
  // 服务端真实进度：cards 总数 + 已 passed 数。与 swipe 学习屏共享数据源，
  // 避免首页用 KpProductLink/静态 mock 计数、Learn 用 ProductKp 计数，两边对不上。
  const [serverProgress, setServerProgress] = useState(null);
  useEffect(() => {
    if (!product?.id || !account?.id) return;
    let alive = true;
    fetchLearningCards(product.id, account.id)
      .then((data) => {
        if (!alive) return;
        const items = data.items || [];
        const passedIds = items.filter((c) => c.progress?.status === 'passed').map((c) => `kp-${c.kp_id}`);
        setServerProgress({ total: items.length, passed: passedIds.length });
        // 回填 learnedPoints，让其它依赖 state.learnedPoints 的位置（如 Practice 解锁逻辑）也一致
        if (setState && passedIds.length) {
          setState((s) => ({ ...s, learnedPoints: new Set([...(s.learnedPoints || new Set()), ...passedIds]) }));
        }
      })
      .catch(() => { /* 后端不可达时回退到静态 product.meta + 本地 state */ });
    return () => { alive = false; };
  }, [product?.id, account?.id, setState]);

  // 服务端可用时优先用服务端，否则回退到原静态计算
  const learnTotal = serverProgress?.total ?? product.meta.knowledgeTotal;
  const learnDone = serverProgress?.passed ?? state.learnedPoints.size;
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

  const hour = new Date().getHours();
  const salute = hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const progressSub = reportReady
    ? `${product.meta.name} · 今日训练已完成 ✓`
    : practiced
      ? `${product.meta.name} · 演练完成，待查看评估`
      : learnPct >= 1
        ? `${product.meta.name} · 知识学习完成，待演练`
        : learnDone > 0
          ? `${product.meta.name} · 学习中 ${learnDone}/${learnTotal} 个知识点`
          : `${product.meta.name} · 点击开始今日训练`;

  return (
    <div style={{ padding: '4px 18px 96px', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
        <div style={{ fontSize: 26, fontWeight: 700, color: t.text, marginTop: 6, letterSpacing: '-0.01em' }}>{salute}，{account.name}</div>
        <div style={{ fontSize: 14, color: t.textSoft, marginTop: 6 }}>{progressSub}</div>
        {switchProduct && (
          <div style={{ marginTop: 10 }}>
            <CourseSwitcher t={t} account={account} product={product} switchProduct={switchProduct} />
          </div>
        )}
      </div>

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

      {/* 考 — Assessment（仅展示挂在本产品上、或未挂产品的通用考核） */}
      <AssessmentEntry t={t} accountId={account.id} product={product} go={go} />
    </div>
  );
}

// 取本账号最相关的一份待处理考核；已完成 / 已停止在账号首页收纳，不占课程主流程。
function pickPrimaryAssessment(items) {
  if (!items || !items.length) return null;
  const order = { in_progress: 0, pending: 1, submitted: 2 };
  return items
    .filter((it) => !['graded', 'stopped'].includes(it.status))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))[0] || null;
}

// 按产品过滤：
//   - template.product_id == null：通用考核，任何产品页都可见
//   - 否则必须 === product.meta.backendId（后端 DB 的 int id）
// 静态 mock 产品没有 backendId，只能匹配到「通用」类型的考核。
function filterForProduct(items, product) {
  const pid = product?.meta?.backendId ?? null;
  return items.filter(it => {
    const tpid = it.template?.product_id;
    if (tpid == null) return true;
    return pid != null && pid === tpid;
  });
}

function AssessmentEntry({ t, accountId, product, go }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    listByAccount(accountId)
      .then(list => { if (alive) setItems(list); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [accountId]);
  if (!items || items.length === 0) return null;
  const visible = filterForProduct(items, product);
  if (visible.length === 0) return null;
  const pick = pickPrimaryAssessment(visible);
  if (!pick) return null;
  const { template, status, score } = pick;
  const isGraded = status === 'graded';
  const sub = isGraded
    ? `${template.title} · 得分 ${score != null ? score.toFixed(1) : '-'} / 及格 ${template.pass_score}`
    : `${template.title} · ${template.num_questions} 题 · ${template.mode === 'bank' ? '题库' : 'AI 主考'}`;
  return (
    <ModuleEntry
      t={t}
      kind="exam"
      title="考核任务"
      sub={sub}
      progress={isGraded ? 1 : status === 'in_progress' ? 0.4 : 0}
      status={isGraded ? 'done' : 'active'}
      icon="chart"
      isNext={!isGraded}
      nextCta={status === 'in_progress' ? '继续作答 →' : status === 'pending' ? '开始考核 →' : '查看成绩 →'}
      onClick={() => go('assessment', { token: pick.token })}
    />
  );
}

// 课程切换器（S2）：演示中途切产品不必返回 accounts 页。
// 可见课程由账号 active 分发决定；未加载的动态课程会走 switchProduct 异步加载。
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

  const visibleIds = getVisibleProductIds(account);

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

function ModuleEntry({ t, kind, title, sub, progress, status, icon, lockHint, isNext, nextCta, onClick }) {
  const locked = status === 'locked';
  const done = status === 'done';
  return (
    <Card t={t} onClick={locked ? undefined : onClick} style={{
      padding: 18, opacity: locked ? 0.78 : 1, display: 'flex', alignItems: 'center', gap: 16,
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
          color: locked ? t.warn : isNext ? t.accent : t.textSoft,
          fontWeight: locked ? 600 : isNext ? 700 : 400,
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
// 改造后：左右滑动一张张卡片。每张卡四态：
//   reading → confirming-start → answering → evaluated（+ reading-review 复习入口）。
// AI 评分通过 → "下一张"；未通过 → 可重读 / 重答 / 跳过。
// 加目录抽屉（按 category 分组）、多色 stacked 进度条、答题中返回拦截。
function LearningScreen({ t, state, setState, go, product, highlight, account }) {
  const productCode = product?.id;
  const productName = product?.meta?.name || '';
  const passScoreFallback = 70;

  const [cards, setCards] = useState(null);
  const [productInfo, setProductInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  // 活动卡片向父级回报当前 phase + 草稿答案，用于返回拦截
  const activeCardStateRef = useRef({ phase: 'reading', answer: '' });

  useEffect(() => {
    if (!productCode || !account?.id) return;
    let alive = true;
    setCards(null);
    setLoadError('');
    fetchLearningCards(productCode, account.id)
      .then((data) => {
        if (!alive) return;
        setCards(data.items || []);
        setProductInfo(data.product || null);
        // 进入时把已通过的合并进 learnedPoints（与首页进度条沿用同一份数据源）
        const passedIds = (data.items || [])
          .filter((c) => c.progress?.status === 'passed')
          .map((c) => `kp-${c.kp_id}`);
        if (passedIds.length) {
          setState((s) => ({ ...s, learnedPoints: new Set([...(s.learnedPoints || new Set()), ...passedIds]) }));
        }
        // highlight 命中则定位
        if (highlight) {
          const idx = (data.items || []).findIndex((c) => `kp-${c.kp_id}` === highlight);
          if (idx >= 0) setActiveIdx(idx);
        }
      })
      .catch((e) => { if (alive) setLoadError(e.message || '加载失败'); });
    return () => { alive = false; };
  }, [productCode, account?.id, highlight, setState]);

  const passScore = productInfo?.pass_score ?? passScoreFallback;
  const total = cards?.length || 0;
  const passedCount = (cards || []).filter((c) => c.progress?.status === 'passed').length;

  if (!productCode || !account?.id) {
    return (
      <div style={{ padding: '4px 18px 18px' }}>
        <TopBar t={t} title={`学习课程 · ${productName}`} onBack={() => go('home')} />
        <div style={{ marginTop: 24, padding: 24, textAlign: 'center', color: t.textMute }}>账号未识别，无法记录进度。</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: '4px 18px 18px' }}>
        <TopBar t={t} title={`学习课程 · ${productName}`} onBack={() => go('home')} />
        <div style={{ marginTop: 24, padding: 24, borderRadius: 14, border: `1px dashed ${t.line}`, color: t.bad, fontSize: 13, lineHeight: 1.6 }}>
          加载失败：{loadError}
        </div>
      </div>
    );
  }

  if (cards === null) {
    return (
      <div style={{ padding: '4px 18px 18px' }}>
        <TopBar t={t} title={`学习课程 · ${productName}`} onBack={() => go('home')} />
        <div style={{ marginTop: 24, padding: 24, textAlign: 'center', color: t.textMute }}>加载中...</div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div style={{ padding: '4px 18px 18px' }}>
        <TopBar t={t} title={`学习课程 · ${productName}`} onBack={() => go('home')} />
        <div style={{
          marginTop: 24, padding: '32px 20px', textAlign: 'center',
          borderRadius: 18, border: `1px dashed ${t.line}`,
          color: t.textMute, fontSize: 14, lineHeight: 1.7,
        }}>
          该课程尚未编排知识点。<br />
          请联系管理员在后台为本产品挂载并生成考题。
        </div>
      </div>
    );
  }

  const updateCardProgress = (kpId, progressPatch) => {
    setCards((prev) => prev.map((c) => (c.kp_id === kpId ? { ...c, progress: { ...(c.progress || {}), ...progressPatch } } : c)));
  };

  const handlePassed = (kpId) => {
    // 同步 learnedPoints，让首页进度条立刻更新
    setState((s) => ({
      ...s,
      learnedPoints: new Set([...(s.learnedPoints || new Set()), `kp-${kpId}`]),
    }));
  };

  const goNext = () => {
    if (activeIdx < total - 1) setActiveIdx(activeIdx + 1);
  };
  const goPrev = () => {
    if (activeIdx > 0) setActiveIdx(activeIdx - 1);
  };

  // 按状态计数（passed/failed/skipped/其他 = 未学）
  const statusCounts = (cards || []).reduce((acc, c) => {
    const s = c.progress?.status;
    if (s === 'passed') acc.passed += 1;
    else if (s === 'failed') acc.failed += 1;
    else if (s === 'skipped') acc.skipped += 1;
    else acc.unseen += 1;
    return acc;
  }, { passed: 0, failed: 0, skipped: 0, unseen: 0 });

  const handleBack = () => {
    const s = activeCardStateRef.current;
    if (s.phase === 'answering' && (s.answer || '').trim()) {
      setLeaveModalOpen(true);
    } else {
      go('home');
    }
  };

  const jumpTo = (idx) => {
    if (idx >= 0 && idx < total) setActiveIdx(idx);
    setDrawerOpen(false);
  };

  return (
    <div style={{ padding: '4px 18px 18px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <TopBar t={t} title={`学习课程 · ${productName}`} onBack={handleBack} />
        </div>
        <div onClick={() => setDrawerOpen(true)} title="目录" style={{
          padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
          background: t.surface, fontSize: 13, color: t.text, fontWeight: 600,
          boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 16 }}>📑</span>
          <span style={{ fontSize: 12 }}>{activeIdx + 1}/{total}</span>
        </div>
      </div>

      {/* 顶部多色 stacked 进度条 */}
      <StackedProgressBar
        t={t}
        total={total}
        counts={statusCounts}
        currentIdx={activeIdx}
        passScore={passScore}
      />

      {/* 横向 swipe 容器 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          gap: 0,
          scrollbarWidth: 'none',
        }}
        ref={(el) => {
          // 让 activeIdx 改变时滚动到对应卡片
          if (!el) return;
          const target = el.children[activeIdx];
          if (target && Math.abs(target.offsetLeft - el.scrollLeft) > 4) {
            el.scrollTo({ left: target.offsetLeft, behavior: 'smooth' });
          }
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / el.clientWidth);
          if (idx !== activeIdx && idx >= 0 && idx < total) setActiveIdx(idx);
        }}
      >
        {cards.map((card, i) => (
          <LearningCard
            key={card.kp_id}
            t={t}
            card={card}
            productId={productInfo?.id}
            accountRef={account.id}
            passScore={passScore}
            isActive={i === activeIdx}
            onReportState={(s) => {
              if (i === activeIdx) activeCardStateRef.current = s;
            }}
            onPassed={(kpId, score, feedback) => {
              handlePassed(kpId);
              updateCardProgress(kpId, { status: 'passed', last_score: score, last_feedback: feedback });
            }}
            onFailed={(kpId, score, feedback) => updateCardProgress(kpId, { status: 'failed', last_score: score, last_feedback: feedback })}
            onSkipped={(kpId) => updateCardProgress(kpId, { status: 'skipped' })}
            onNext={goNext}
            onPrev={goPrev}
            isFirst={i === 0}
            isLast={i === total - 1}
            go={go}
          />
        ))}
      </div>

      {/* 目录抽屉 */}
      {drawerOpen && (
        <IndexDrawer
          t={t}
          cards={cards}
          activeIdx={activeIdx}
          statusCounts={statusCounts}
          onJump={jumpTo}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* 答题中按返回 → 防丢答案确认 */}
      {leaveModalOpen && (
        <ConfirmModal
          t={t}
          title="离开当前考核？"
          body="你已写入答案但未提交，离开会丢失这次输入。"
          cancelText="继续答题"
          confirmText="离开"
          confirmDanger
          onCancel={() => setLeaveModalOpen(false)}
          onConfirm={() => { setLeaveModalOpen(false); go('home'); }}
        />
      )}
    </div>
  );
}

// 单张学习卡：左右占满；内部有三态——阅读 / 答题 / 评估。
function LearningCard({ t, card, productId, accountRef, passScore, isActive, onReportState, onPassed, onFailed, onSkipped, onNext, onPrev, isFirst, isLast, go }) {
  const status = card.progress?.status;
  const passed = status === 'passed';
  const previouslyAttempted = status === 'passed' || status === 'failed';
  // phase: reading | reading-review | confirming-start | answering | submitting | evaluated
  // passed 的卡进入复习视图；其余进入阅读
  const [phase, setPhase] = useState(passed ? 'reading-review' : 'reading');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(previouslyAttempted && card.progress?.last_feedback ? {
    passed,
    score: card.progress.last_score,
    feedback: card.progress.last_feedback,
  } : null);
  const [error, setError] = useState('');

  const examReady = card.exam_status === 'ready' && (card.exam_question || '').trim();

  // 把当前 phase + 草稿答案回报给父级 LearningScreen，用于返回拦截
  useEffect(() => {
    if (isActive && onReportState) {
      onReportState({ phase, answer });
    }
  }, [isActive, phase, answer, onReportState]);

  const submit = async () => {
    if (!answer.trim()) return;
    setPhase('submitting');
    setError('');
    try {
      const r = await submitLearningAnswer({ kpId: card.kp_id, productId, answer, accountRef });
      setResult(r);
      setPhase('evaluated');
      if (r.passed) onPassed(card.kp_id, r.score, r.feedback);
      else onFailed(card.kp_id, r.score, r.feedback);
    } catch (e) {
      setError(e.message || '提交失败');
      setPhase('answering');
    }
  };

  const skip = async () => {
    try {
      await skipLearningKp({ kpId: card.kp_id, productId, accountRef });
      onSkipped(card.kp_id);
      if (!isLast) onNext();
    } catch (e) {
      setError(e.message || '跳过失败');
    }
  };

  // 从阅读态发起考核 → 先弹确认
  const askStartExam = () => setPhase('confirming-start');
  const confirmStartExam = () => {
    setAnswer('');
    setError('');
    setPhase('answering');
  };
  const cancelStartExam = () => setPhase(passed ? 'reading-review' : 'reading');

  // 评估态分流：通过 → 复习视图；未通过 → 再答 / 再读
  const reReadFromEval = () => { setResult(null); setError(''); setPhase('reading'); };
  const retryFromEval = () => { setAnswer(''); setResult(null); setError(''); setPhase('answering'); };
  const reviewFromEval = () => { setPhase('reading-review'); };

  return (
    <div style={{
      flex: '0 0 100%', width: '100%',
      scrollSnapAlign: 'start',
      display: 'flex', flexDirection: 'column',
      minHeight: 0,
      padding: '0 2px',
      position: 'relative',
    }}>
      <Card t={t} style={{
        flex: 1, padding: 0, display: 'flex', flexDirection: 'column',
        minHeight: 0, overflow: 'hidden',
      }}>
        {(phase === 'reading' || phase === 'reading-review') && (
          <ReadingPane
            t={t}
            card={card}
            isReview={phase === 'reading-review'}
            lastStatus={status}
            lastScore={card.progress?.last_score}
            passScore={passScore}
            onStartExam={askStartExam}
            onSkip={skip}
            onPrev={isFirst ? null : onPrev}
            onNext={!isLast ? onNext : null}
            examReady={examReady}
            onAskAI={() => go('aiqa')}
          />
        )}
        {(phase === 'answering' || phase === 'submitting') && (
          <AnsweringPane
            t={t}
            card={card}
            answer={answer}
            setAnswer={setAnswer}
            onSubmit={submit}
            onSkip={skip}
            submitting={phase === 'submitting'}
            error={error}
          />
        )}
        {phase === 'evaluated' && result && (
          <EvaluatedPane
            t={t}
            card={card}
            result={result}
            passScore={passScore}
            onReRead={reReadFromEval}
            onRetry={retryFromEval}
            onReview={reviewFromEval}
            onSkip={skip}
            onNext={onNext}
            isLast={isLast}
            go={go}
          />
        )}
      </Card>

      {/* 开始考核确认 modal */}
      {phase === 'confirming-start' && (
        <ConfirmModal
          t={t}
          title="准备好闭卷考核了吗？"
          body="进入答题后，卡片内容会被隐藏，需要靠记忆完成回答。如果还没准备好，可以再读一遍卡片。"
          cancelText="再读一遍"
          confirmText="开始答题"
          onCancel={cancelStartExam}
          onConfirm={confirmStartExam}
        />
      )}
    </div>
  );
}

function ReadingPane({ t, card, isReview, lastStatus, lastScore, passScore, onStartExam, onSkip, onPrev, onNext, examReady, onAskAI }) {
  const [specExpanded, setSpecExpanded] = useState(false);
  const showLastResultBadge = isReview || lastStatus === 'failed';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px' }}>
        {showLastResultBadge && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 999, marginBottom: 12,
            background: isReview ? `${t.good}18` : `${t.warn}18`,
            color: isReview ? t.good : t.warn,
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
          }}>
            <span>{isReview ? '✓ 已通过' : '· 上次未通过'}</span>
            {lastScore != null && <span>· 上次 {Math.round(lastScore)} 分</span>}
          </div>
        )}
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em' }}>
          {card.category || '通用知识'} · KP {card.order_index + 1}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: t.text, marginTop: 6, letterSpacing: '-0.01em' }}>
          {card.title}
        </div>
        {card.definition && (
          <div style={{ fontSize: 14, color: t.textSoft, marginTop: 10, lineHeight: 1.6 }}>{card.definition}</div>
        )}

        {/* 销售应用提示 → Hero：排在产品参数之前，视觉权重最高 */}
        {card.sales && (
          <div style={{
            marginTop: 16, padding: '14px 16px', borderRadius: 14,
            background: `linear-gradient(135deg, ${t.accent}16, ${t.accentSoft}10)`,
            borderLeft: `4px solid ${t.accent}`,
          }}>
            <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>销售应用提示</div>
            <div style={{ fontSize: 14.5, color: t.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontWeight: 500 }}>{card.sales}</div>
          </div>
        )}

        {/* 产品参数 → 默认折叠，作为参考资料 */}
        {card.spec && (
          <div style={{ marginTop: 12 }}>
            <div
              onClick={() => setSpecExpanded(e => !e)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 14px',
                borderRadius: specExpanded ? '12px 12px 0 0' : 12,
                background: t.surface2, cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', flex: 1 }}>产品参数</div>
              <span style={{
                fontSize: 11, color: t.textMute,
                display: 'inline-block',
                transform: specExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform .2s',
              }}>▾</span>
            </div>
            {specExpanded && (
              <div style={{
                padding: '10px 14px 12px',
                borderRadius: '0 0 12px 12px',
                background: t.surface2,
                borderTop: `1px solid ${t.line}`,
              }}>
                <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{card.spec}</div>
              </div>
            )}
          </div>
        )}

        {card.customer_voice && (
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: t.surface2 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>典型客户原话</div>
            <div style={{ fontSize: 13, color: t.textSoft, lineHeight: 1.6, fontStyle: 'italic' }}>"{card.customer_voice}"</div>
          </div>
        )}
        {Array.isArray(card.rebuttals) && card.rebuttals.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>异议处理</div>
            {card.rebuttals.map((r, i) => (
              <div key={i} style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: t.surface2 }}>
                <div style={{ fontSize: 12.5, color: t.text, fontWeight: 600 }}>客户: {r.q || ''}</div>
                <div style={{ fontSize: 12.5, color: t.textSoft, marginTop: 4, lineHeight: 1.55 }}>{r.approach || ''}</div>
              </div>
            ))}
          </div>
        )}
        {!examReady && (
          <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: `${t.warn}15`, fontSize: 12, color: t.warn, lineHeight: 1.5 }}>
            考题准备中，暂无法进入考核。
          </div>
        )}

        {/* 内联 AI 入口：锚定在内容末尾，语境清晰，不遮挡任何操作 */}
        {onAskAI && (
          <div
            onClick={onAskAI}
            style={{
              marginTop: 16, marginBottom: 4,
              padding: '11px 14px', borderRadius: 13,
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer',
              background: `${t.accent}0d`,
              border: `1px dashed ${t.accent}38`,
              transition: 'background .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${t.accent}18`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${t.accent}0d`; }}
          >
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `2px 2px 6px ${t.sDark}`,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>卡壳了？问 AI 私教</div>
              <div style={{ fontSize: 11, color: t.textSoft, marginTop: 2 }}>随时解答，不打断学习节奏</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        )}
      </div>

      {/* 底部操作区：导航箭头始终可见；去掉闭卷警告文字（ConfirmModal 已说明）；跳过改为中性样式 */}
      <div style={{
        padding: '12px 16px 16px',
        display: 'flex', flexDirection: 'column', gap: 6,
        borderTop: `1px solid ${t.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 始终占位，避免主按钮宽度跳动 */}
          <div
            onClick={onPrev || undefined}
            title="上一张"
            style={{
              width: 44, height: 44, borderRadius: 14, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: onPrev ? 'pointer' : 'default',
              background: onPrev ? t.surface2 : 'transparent',
              fontSize: 16, color: onPrev ? t.textSoft : 'transparent',
              fontWeight: 600,
              transition: 'background .15s',
            }}
          >←</div>

          <PillButton
            t={t} primary disabled={!examReady}
            onClick={examReady ? onStartExam : undefined}
            style={{ flex: 1, padding: '13px 16px', fontSize: 15 }}
          >
            {!examReady ? '考题准备中…' : isReview ? '再挑战一次 →' : '我学会了，去考核 →'}
          </PillButton>

          <div
            onClick={onNext || undefined}
            title="下一张"
            style={{
              width: 44, height: 44, borderRadius: 14, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: onNext ? 'pointer' : 'default',
              background: onNext ? t.surface2 : 'transparent',
              fontSize: 16, color: onNext ? t.textSoft : 'transparent',
              fontWeight: 600,
              transition: 'background .15s',
            }}
          >→</div>
        </div>

        {!isReview && (
          <div
            onClick={onSkip}
            style={{
              textAlign: 'center',
              fontSize: 12, color: t.textMute, fontWeight: 500,
              cursor: 'pointer', padding: '2px 0',
            }}
          >先跳过</div>
        )}
        {!examReady && (
          <div style={{ textAlign: 'center', fontSize: 11, color: t.textMute }}>管理员后台生成考题中</div>
        )}
      </div>
    </div>
  );
}

function AnsweringPane({ t, card, answer, setAnswer, onSubmit, onSkip, submitting, error }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, padding: '20px 18px', overflowY: 'auto' }}>
        <div style={{
          display: 'inline-block',
          padding: '4px 10px', borderRadius: 999,
          background: `${t.warn}20`, color: t.warn,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        }}>● 闭卷答题 · 不可回看</div>
        <div style={{ fontSize: 13, color: t.textMute, marginTop: 12 }}>{card.title}</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: t.text, marginTop: 8, lineHeight: 1.45 }}>
          {card.exam_question}
        </div>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="请用自己的话回答……"
          disabled={submitting}
          style={{
            width: '100%', marginTop: 16, minHeight: 160,
            padding: 14, fontSize: 14, lineHeight: 1.6,
            border: 'none', outline: 'none', resize: 'vertical',
            borderRadius: 14, background: t.surface2, color: t.text,
            boxShadow: `inset 2px 2px 4px ${t.sDark}, inset -2px -2px 4px ${t.sLight}`,
            fontFamily: 'inherit',
          }}
        />
        {error && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: `${t.bad}15`, color: t.bad, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
      <div style={{ padding: '12px 16px 16px', display: 'flex', gap: 10, borderTop: `1px solid ${t.line}` }}>
        <div onClick={submitting ? undefined : onSkip} style={{
          padding: '10px 14px', borderRadius: 999, cursor: submitting ? 'not-allowed' : 'pointer',
          background: t.surface2, fontSize: 13, color: t.textMute, fontWeight: 600,
          opacity: submitting ? 0.5 : 1,
        }}>跳过</div>
        <div style={{ flex: 1 }} />
        <PillButton t={t} primary disabled={submitting || !answer.trim()} onClick={onSubmit}>
          {submitting ? 'AI 评估中…' : '提交答案'}
        </PillButton>
      </div>
    </div>
  );
}

function EvaluatedPane({ t, card, result, passScore, onReRead, onRetry, onReview, onSkip, onNext, isLast, go }) {
  const passed = !!result.passed;
  const score = result.score ?? 0;
  const scoreRounded = Math.round(score);
  const gap = passScore - scoreRounded;
  const fb = result.feedback || {};
  const breakdown = Array.isArray(fb.rubric_breakdown) ? fb.rubric_breakdown : [];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, padding: '20px 18px', overflowY: 'auto' }}>

        {/* 情绪头部：通过 */}
        {passed ? (
          <div style={{
            padding: '18px 16px', borderRadius: 16,
            background: `linear-gradient(135deg, ${t.good}22, ${t.good}08)`,
            border: `1px solid ${t.good}2a`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 60, height: 60, borderRadius: 999, flexShrink: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: t.good, color: '#fff',
                boxShadow: `0 4px 14px ${t.good}55`,
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{scoreRounded}</div>
                <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.8, marginTop: 1 }}>分</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.good, letterSpacing: '-0.01em' }}>
                  答对了！
                </div>
                <div style={{ fontSize: 12.5, color: t.textSoft, marginTop: 4, lineHeight: 1.45 }}>
                  继续往下走，保持这个节奏
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* 情绪头部：未通过——用暖琥珀色替代红色，重新框为"接近了" */
          <div style={{
            padding: '18px 16px', borderRadius: 16,
            background: `linear-gradient(135deg, ${t.warn}18, ${t.warn}06)`,
            border: `1px solid ${t.warn}28`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 60, height: 60, borderRadius: 999, flexShrink: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: t.warn, color: '#fff',
                boxShadow: `0 4px 14px ${t.warn}45`,
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{scoreRounded}</div>
                <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.8, marginTop: 1 }}>分</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.warn, letterSpacing: '-0.01em' }}>
                  差一点点
                </div>
                <div style={{ fontSize: 12.5, color: t.textSoft, marginTop: 4, lineHeight: 1.45 }}>
                  {gap > 0 ? `还差 ${gap} 分到及格，再读一遍就能过` : '非常接近及格线，再来一次'}
                </div>
              </div>
            </div>
          </div>
        )}
        {fb.comment && (
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: t.surface2 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>AI 点评</div>
            <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.6 }}>{fb.comment}</div>
          </div>
        )}
        {breakdown.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>评分要点</div>
            {breakdown.map((b, i) => {
              const status = b.status || 'miss';
              const color = status === 'hit' ? t.good : status === 'partial' ? t.warn : t.bad;
              const tag = status === 'hit' ? '命中' : status === 'partial' ? '部分' : '缺失';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                  borderRadius: 10, background: t.surface2, marginBottom: 8,
                }}>
                  <div style={{
                    flexShrink: 0, padding: '2px 8px', borderRadius: 999,
                    background: `${color}22`, color, fontSize: 10, fontWeight: 700,
                  }}>{tag}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: t.text, fontWeight: 600 }}>{b.point || ''}</div>
                    {b.note && <div style={{ fontSize: 12, color: t.textSoft, marginTop: 3, lineHeight: 1.55 }}>{b.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {Array.isArray(fb.missing_points) && fb.missing_points.length > 0 && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: `${t.warn}12` }}>
            <div style={{ fontSize: 11, color: t.warn, fontWeight: 700, marginBottom: 4 }}>建议补强</div>
            <div style={{ fontSize: 12.5, color: t.textSoft, lineHeight: 1.5 }}>{fb.missing_points.join('；')}</div>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: `1px solid ${t.line}` }}>
        {passed ? (
          <>
            <div onClick={onReview} style={{
              padding: '10px 14px', borderRadius: 999, cursor: 'pointer',
              background: t.surface2, fontSize: 13, color: t.text, fontWeight: 600,
              boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
            }}>查看卡片</div>
            <div style={{ flex: 1 }} />
            {!isLast ? (
              <PillButton t={t} primary onClick={onNext}>下一张 →</PillButton>
            ) : (
              <PillButton t={t} primary onClick={() => go('home')}>返回首页 →</PillButton>
            )}
          </>
        ) : (
          <>
            <div onClick={onReRead} style={{
              padding: '10px 14px', borderRadius: 999, cursor: 'pointer',
              background: t.surface2, fontSize: 13, color: t.text, fontWeight: 600,
              boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
            }}>再读一遍</div>
            <div onClick={onRetry} style={{
              padding: '10px 14px', borderRadius: 999, cursor: 'pointer',
              background: t.surface2, fontSize: 13, color: t.text, fontWeight: 600,
              boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
            }}>再答一次</div>
            <div onClick={onSkip} style={{
              padding: '10px 14px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12.5, color: t.textMute, fontWeight: 500,
            }}>跳过本题</div>
          </>
        )}
      </div>
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

// ═══ Learning UX 子组件 ═══════════════════════════════════════════
// 多色 stacked 进度条：把 50 张卡的状态分布一眼可视化
function StackedProgressBar({ t, total, counts, currentIdx, passScore }) {
  const { passed, failed, skipped, unseen } = counts;
  const seg = (n, color) => (
    n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: color, height: '100%' }} /> : null
  );
  return (
    <div style={{ padding: '8px 4px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', ...neuInset(t, 999, 0.4) }}>
        {seg(passed, t.good)}
        {seg(failed, t.bad)}
        {seg(skipped, t.textMute)}
        {seg(unseen, `${t.accentSoft}40`)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: t.textMute, flexWrap: 'wrap' }}>
        <span style={{ color: t.good, fontWeight: 700 }}>● 通过 {passed}</span>
        <span style={{ color: t.bad, fontWeight: 600 }}>● 失败 {failed}</span>
        <span style={{ color: t.textMute, fontWeight: 600 }}>● 跳过 {skipped}</span>
        <span>○ 未学 {unseen}</span>
        <span style={{ marginLeft: 'auto' }}>当前 第 {currentIdx + 1} / {total} 张 · 及格 {passScore}</span>
      </div>
    </div>
  );
}

// 目录抽屉：按 KP category 分组列出全部卡片，状态徽标 + 点击跳转
function IndexDrawer({ t, cards, activeIdx, statusCounts, onJump, onClose }) {
  // 按 category 分组（保持后端返回顺序）
  const groups = useMemo(() => {
    const order = [];
    const map = new Map();
    cards.forEach((c, i) => {
      const cat = c.category || '未分类';
      if (!map.has(cat)) { map.set(cat, []); order.push(cat); }
      map.get(cat).push({ card: c, idx: i });
    });
    return order.map((name) => {
      const items = map.get(name);
      const passed = items.filter((it) => it.card.progress?.status === 'passed').length;
      return { name, items, passed, total: items.length };
    });
  }, [cards]);

  const [collapsed, setCollapsed] = useState({});
  const toggle = (name) => setCollapsed((p) => ({ ...p, [name]: !p[name] }));

  const statusBadge = (status) => {
    if (status === 'passed') return { txt: '✓', color: t.good, bg: `${t.good}20` };
    if (status === 'failed') return { txt: '✗', color: t.bad, bg: `${t.bad}18` };
    if (status === 'skipped') return { txt: '⊘', color: t.textMute, bg: `${t.textMute}22` };
    return { txt: '○', color: t.textMute, bg: 'transparent' };
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(420px, 92vw)', height: '100%',
        background: t.bg, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 18px', borderBottom: `1px solid ${t.line}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>课程目录</div>
          <div style={{ flex: 1 }} />
          <div onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 999, cursor: 'pointer',
            background: t.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: t.textSoft, fontWeight: 600,
          }}>×</div>
        </div>
        {/* 统计 sticky */}
        <div style={{
          padding: '10px 18px', borderBottom: `1px solid ${t.line}`,
          fontSize: 11.5, color: t.textSoft, display: 'flex', flexWrap: 'wrap', gap: 12,
        }}>
          <span><span style={{ color: t.good, fontWeight: 700 }}>{statusCounts.passed}</span> 通过</span>
          <span><span style={{ color: t.bad, fontWeight: 700 }}>{statusCounts.failed}</span> 失败</span>
          <span><span style={{ color: t.textMute, fontWeight: 700 }}>{statusCounts.skipped}</span> 跳过</span>
          <span><span style={{ color: t.text, fontWeight: 700 }}>{statusCounts.unseen}</span> 未学</span>
          <span style={{ marginLeft: 'auto' }}>共 {cards.length} 张</span>
        </div>
        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>
          {groups.map((g) => {
            const isCollapsed = !!collapsed[g.name];
            return (
              <div key={g.name} style={{ marginBottom: 12 }}>
                <div onClick={() => toggle(g.name)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  borderRadius: 12, cursor: 'pointer',
                  background: g.passed === g.total && g.total > 0 ? `${t.good}12` : t.surface2,
                }}>
                  <div style={{ fontSize: 11, color: g.passed === g.total && g.total > 0 ? t.good : t.textMute, transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>▼</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, flex: 1 }}>{g.name}</div>
                  {g.passed === g.total && g.total > 0
                    ? <div style={{ fontSize: 11, color: t.good, fontWeight: 700 }}>全部通过 ✓</div>
                    : <div style={{ fontSize: 11, color: t.textMute }}>{g.passed}/{g.total}</div>
                  }
                </div>
                {!isCollapsed && (
                  <div style={{ marginTop: 4 }}>
                    {g.items.map(({ card: c, idx }) => {
                      const badge = statusBadge(c.progress?.status);
                      const isActive = idx === activeIdx;
                      return (
                        <div key={c.kp_id} onClick={() => onJump(idx)} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px', margin: '2px 0',
                          borderRadius: 10, cursor: 'pointer',
                          background: isActive ? `${t.accent}18` : 'transparent',
                          border: isActive ? `1px solid ${t.accent}55` : '1px solid transparent',
                        }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: 999,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: badge.bg, color: badge.color,
                            fontSize: 12, fontWeight: 700, flexShrink: 0,
                            border: c.progress?.status === 'unseen' || !c.progress?.status ? `1px solid ${t.line}` : 'none',
                          }}>{badge.txt}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: t.text, fontWeight: isActive ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {idx + 1}. {c.title}
                            </div>
                            {c.progress?.last_score != null && c.progress?.status !== 'passed' && (
                              <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 2 }}>上次 {Math.round(c.progress.last_score)} 分</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 通用确认弹窗
function ConfirmModal({ t, title, body, cancelText, confirmText, onCancel, onConfirm, confirmDanger }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(420px, 100%)', background: t.bg,
        borderRadius: 18, padding: 22,
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>{title}</div>
        {body && <div style={{ fontSize: 13.5, color: t.textSoft, marginTop: 10, lineHeight: 1.6 }}>{body}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <div onClick={onCancel} style={{
            padding: '10px 16px', borderRadius: 999, cursor: 'pointer',
            background: t.surface2, fontSize: 13, color: t.text, fontWeight: 600,
          }}>{cancelText || '取消'}</div>
          <PillButton t={t} primary onClick={onConfirm}
            style={confirmDanger ? { background: t.bad } : undefined}>
            {confirmText || '确认'}
          </PillButton>
        </div>
      </div>
    </div>
  );
}

export { HomeScreen, LearningScreen, BottomCTA };
