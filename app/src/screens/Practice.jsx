// screens-practice.jsx — Open chat with AI customer + hints + profile sheet
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";
import { MissedHint, AmmoStrip, KnowledgeLibrarySheet, KpDetailModal } from "./PracticeKnowledge.jsx";
import { streamChat } from "../lib/llmClient.js";

function PracticeScreen({ t, state, setState, go, tweaks }) {
  const { CUSTOMER, CUSTOMERS, CUSTOMER_INDEX, SCRIPT, KP_INDEX, KNOWLEDGE } = window.SIMUGO_DATA;

  const [customerId, setCustomerId] = useState('zheng');
  const currentCustomer = CUSTOMER_INDEX[customerId] || CUSTOMER;
  const isZheng = customerId === 'zheng'; // 只有郑先生有完整 SCRIPT

  const [started, setStarted] = useState(false);
  const [history, setHistory] = useState([]);
  const [mood, setMood] = useState({ interest: 50, trust: 40 });
  const [picks, setPicks] = useState([]);          // student message log + AI eval per turn
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState('');
  const [showHints, setShowHints] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);     // 📚 full ammo library
  const [kpDetailId, setKpDetailId] = useState(null);        // open KP detail modal
  const [viewedKp, setViewedKp] = useState(() => new Set()); // KPs the student opened
  const [showKpPop, setShowKpPop] = useState(null);
  const [finished, setFinished] = useState(false);
  const scrollRef = useRef(null);
  const sendingRef = useRef(false);  // 同步守卫

  const strictMode = !!tweaks.strictMode;

  // KPs the student has *actually cited* in their messages so far
  const citedKp = useMemo(() => {
    const s = new Set();
    history.forEach(m => {
      if (m.role === 'student' && m.cites) m.cites.forEach(c => s.add(c));
    });
    return s;
  }, [history]);

  const openKpDetail = useCallback((id) => {
    setKpDetailId(id);
    setViewedKp(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev); next.add(id); return next;
    });
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, thinking, started]);

  const startSession = () => {
    if (started) return;
    setStarted(true);
    // Customer opens after a brief delay
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      if (isZheng) {
        setHistory([{ role: 'customer', text: SCRIPT[0].customer, sub: SCRIPT[0].customerSub }]);
      } else {
        // 非郑客户走 open 模式，使用人设里的 opener
        setHistory([{ role: 'customer', text: currentCustomer.opener || '你好。' }]);
      }
    }, 900);
  };

  // Auto-demo mode: walk through script (only valid for 郑先生 scripted flow)
  const turnIdx = useMemo(() => Math.min(picks.length, SCRIPT.length - 1), [picks]);
  useEffect(() => {
    if (!isZheng) return;
    if (tweaks.path === 'manual') return;
    if (finished) return;
    if (thinking) return;
    if (!started) { startSession(); return; }
    const sc = SCRIPT[turnIdx];
    if (!sc) return;
    const want = tweaks.path === 'good' ? 'good' : 'bad';
    const opt = sc.options.find(o => o.quality === want) || sc.options.find(o => o.quality === 'mid') || sc.options[0];
    const id = setTimeout(() => {
      sendScripted(opt, sc);
    }, 1100);
    return () => clearTimeout(id);
  }, [picks.length, tweaks.path, thinking, finished, started, isZheng]);

  // Hints derived from current expected turn
  const hintOptions = SCRIPT[Math.min(picks.length, SCRIPT.length - 1)]?.options || [];

  // Compute missed KPs for a student turn — recommended minus actually cited,
  // only when answer wasn't 'good' so we don't nag on perfect answers.
  const computeMissed = (recommended, cites, quality) => {
    if (quality === 'good') return [];
    const c = new Set(cites || []);
    return (recommended || []).filter(k => !c.has(k)).slice(0, 2);
  };

  // ─── Send a scripted (auto-demo) message ─────────────────
  const sendScripted = (opt, sc) => {
    if (thinking || finished) return;
    const missed = computeMissed(sc.recommendedKp, opt.cites, opt.quality);
    setHistory(h => [...h, { role: 'student', text: opt.text, cites: opt.cites, quality: opt.quality, missedKp: missed }]);
    const evalRec = { turnId: sc.id, optionId: opt.id, quality: opt.quality, cites: opt.cites, skill: opt.skill, feedback: opt.feedback, delta: opt.delta, studentText: opt.text, customerLine: sc.customer };
    setPicks(p => [...p, evalRec]);
    applyMood(opt.delta);
    if (opt.cites.length > 0) {
      setShowKpPop(opt.cites[0]);
      setTimeout(() => setShowKpPop(null), 2200);
    }
    advanceCustomer(sc);
  };

  // ─── Send a free-typed message via Claude (manual mode) ──
  const sendOpen = async () => {
    if (!input.trim() || thinking || finished || sendingRef.current) return;
    sendingRef.current = true;
    const text = input.trim();
    setInput('');
    setShowHints(false);
    setHistory(h => [...h, { role: 'student', text, cites: [], quality: 'pending', missedKp: [] }]);
    setThinking(true);
    const currentTurn = SCRIPT[Math.min(picks.length, SCRIPT.length - 1)];

    // 插入一个空 customer 气泡用于流式填充
    let streamingInserted = false;
    const onCustomerToken = (full) => {
      setHistory(h => {
        const next = [...h];
        if (!streamingInserted) {
          next.push({ role: 'customer', text: full, streaming: true });
          streamingInserted = true;
        } else {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].streaming) { next[i] = { ...next[i], text: full }; break; }
          }
        }
        return next;
      });
      // 注意：thinking 不在这里解除——只在整轮 aiTurn 完成后（含 coach 打分）才解锁，
      // 否则用户能在评分到达前重复发送，导致 history 乱序。底部气泡渲染条件会
      // 在有 streaming 气泡时隐藏 ThinkingDots，避免视觉上的双重 indicator。
    };

    try {
      const result = await aiTurn(text, history, mood, tweaks.difficulty, currentCustomer, onCustomerToken);
      // Patch student message with eval
      const missed = computeMissed(currentTurn?.recommendedKp, result.cites, result.quality);
      setHistory(h => {
        const next = [...h];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'student' && next[i].quality === 'pending') {
            next[i] = { ...next[i], cites: result.cites, quality: result.quality, missedKp: missed };
            break;
          }
        }
        // 把流式气泡定稿（去 streaming 标记，用最终 customerReply）
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].streaming) {
            next[i] = { role: 'customer', text: result.customerReply };
            break;
          }
        }
        if (!streamingInserted) {
          next.push({ role: 'customer', text: result.customerReply });
        }
        if (result.finished) {
          next.push({ role: 'system', text: '客户接受了试驾邀约。本场演练结束。' });
        }
        return next;
      });
      if (result.cites.length > 0) {
        setShowKpPop(result.cites[0]);
        setTimeout(() => setShowKpPop(null), 2200);
      }
      applyMood(result.delta);
      const evalRec = {
        turnId: `t${picks.length + 1}`,
        optionId: 'open',
        quality: result.quality,
        cites: result.cites,
        skill: result.skill,
        feedback: result.feedback,
        delta: result.delta,
        studentText: text,
        customerLine: history[history.length - 1]?.text || '',
      };
      setPicks(p => [...p, evalRec]);
      setThinking(false);
      if (result.finished) finishSession(evalRec);
    } catch (e) {
      console.error(e);
      setThinking(false);
      setHistory(h => [...h, { role: 'system', text: '(网络异常，已切换到脚本模式)' }]);
    } finally {
      sendingRef.current = false;
    }
  };

  // ─── Helpers ──────────────────────────────────────────────
  const applyMood = (delta) => {
    const diff = tweaks.difficulty;
    const scale = diff === 'tough' ? 0.7 : diff === 'gentle' ? 1.3 : 1.0;
    setMood(m => ({
      interest: clamp(m.interest + (delta?.interest || 0) * scale, 0, 100),
      trust:    clamp(m.trust    + (delta?.trust    || 0) * scale, 0, 100),
    }));
  };

  const advanceCustomer = (sc) => {
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      const nextIdx = picks.length + 1;
      if (nextIdx < SCRIPT.length) {
        const ns = SCRIPT[nextIdx];
        setHistory(h => [...h, { role: 'customer', text: ns.customer, sub: ns.customerSub }]);
      } else {
        setHistory(h => [...h, { role: 'system', text: '客户接受了试驾邀约。本场演练结束。' }]);
        finishSession(null);
      }
    }, 1000);
  };

  const finishSession = (lastPick) => {
    setFinished(true);
    setState(s => ({
      ...s,
      practiced: true,
      reportReady: true,
      picks: lastPick && tweaks.path === 'manual' ? [...picks, lastPick] : (picks.length ? picks : []),
      finalMood: mood,
    }));
  };

  // Commit picks to state on unmount / when finished flips
  useEffect(() => {
    if (finished) {
      setState(s => ({ ...s, picks, finalMood: mood, practiced: true, reportReady: true }));
    }
  }, [finished]);

  // Mirror viewed-KP set into shared state so the report can show coverage.
  useEffect(() => {
    setState(s => ({ ...s, viewedKp: Array.from(viewedKp) }));
  }, [viewedKp]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Top bar */}
      <div style={{ padding: '4px 18px 0' }}>
        <TopBar t={t} title="" onBack={() => go('home')} right={
          <div onClick={() => setShowProfile(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{currentCustomer.name}</span>
                <Icon name="arrow" size={12} color={t.textMute} />
              </div>
              <div style={{ fontSize: 10.5, color: t.textMute }}>{currentCustomer.tagline}</div>
            </div>
            <CustomerAvatar t={t} mood={mood} thinking={thinking} />
          </div>
        } />
      </div>

      {/* Mood bars */}
      <div style={{ padding: '0 18px 10px' }}>
        <Card t={t} style={{ padding: '10px 14px', display: 'flex', gap: 14 }}>
          <MoodBar t={t} label="兴趣度" value={mood.interest} color={t.accentSoft} icon="flame" />
          <div style={{ width: 1, background: t.line }} />
          <MoodBar t={t} label="信任度" value={mood.trust} color={t.accent} icon="heart" />
        </Card>
      </div>

      {/* Chat scroll */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
        <ScenarioBrief t={t} started={started} onStart={startSession} customer={currentCustomer}
          customers={CUSTOMERS} onPickCustomer={setCustomerId} isZheng={isZheng} />
        {history.map((m, i) => (
          <React.Fragment key={i}>
            <ChatBubble t={t} m={m} />
            {m.role === 'student' && !strictMode && m.missedKp && m.missedKp.length > 0 && (
              <MissedHint t={t} kpIds={m.missedKp} onOpenKp={openKpDetail} />
            )}
          </React.Fragment>
        ))}
        {/* Contextual ammo strip — 仅郑先生场景（有 SCRIPT）下出现 */}
        {isZheng && !strictMode && !thinking && !finished && started
          && history.length > 0 && history[history.length - 1].role === 'customer'
          && SCRIPT[Math.min(picks.length, SCRIPT.length - 1)]?.recommendedKp && (
          <AmmoStrip
            t={t}
            kpIds={SCRIPT[Math.min(picks.length, SCRIPT.length - 1)].recommendedKp}
            viewedKp={viewedKp}
            citedKp={citedKp}
            onOpenKp={openKpDetail}
          />
        )}
        {thinking && !history.some(h => h.streaming) && <ThinkingDots t={t} />}
        {showKpPop && <KnowledgePopup t={t} kpId={showKpPop} />}
      </div>

      {/* Bottom: hints (collapsible) + input */}
      {!finished ? (
        <BottomBar
          t={t} input={input} setInput={setInput} onSend={sendOpen}
          showHints={showHints} setShowHints={setShowHints} hints={hintOptions}
          onPickHint={(opt) => {
            setInput(opt.text);
            setShowHints(false);
          }}
          onOpenLibrary={() => setShowLibrary(true)}
          autoPath={tweaks.path}
          disabled={thinking || !started}
          started={started}
        />
      ) : (
        <div style={{ padding: '12px 18px 22px' }}>
          <div style={{ ...neuRaised(t, 22, 1.2), padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: t.textSoft }}>演练完成</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>评估报告已生成</div>
            </div>
            <PillButton t={t} primary onClick={() => go('report')}>查看评估 →</PillButton>
          </div>
        </div>
      )}

      {/* Customer profile sheet */}
      {showProfile && <CustomerProfileSheet t={t} customer={currentCustomer} onClose={() => setShowProfile(false)} />}

      {/* Knowledge library bottom sheet */}
      {showLibrary && (
        <KnowledgeLibrarySheet
          t={t}
          viewedKp={viewedKp}
          citedKp={citedKp}
          onOpenKp={openKpDetail}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* KP detail modal */}
      {kpDetailId && (
        <KpDetailModal
          t={t} kpId={kpDetailId}
          cited={citedKp.has(kpDetailId)}
          onClose={() => setKpDetailId(null)}
        />
      )}
    </div>
  );
}



function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ─── AI turn via 后端 LangGraph (SSE) ──────────────────────
async function aiTurn(studentText, history, mood, difficulty, customer, onCustomerToken) {
  const { KP_INDEX } = window.SIMUGO_DATA;
  const C = customer || window.SIMUGO_DATA.CUSTOMER;
  const kpList = Object.entries(KP_INDEX).map(([id, ref]) => ({
    id, summary: `${ref.module.title}-${ref.point.title} (${ref.point.spec})`,
  }));

  let streamedReply = '';
  let result = null;
  let errored = false;

  await streamChat({
    endpoint: '/api/practice/turn',
    body: {
      customer: C,
      history: history.filter(h => h.role !== 'system').map(h => ({ role: h.role, text: h.text })),
      student_text: studentText,
      mood,
      difficulty,
      kp_list: kpList,
    },
    onToken: (text) => {
      streamedReply += text;
      if (onCustomerToken) onCustomerToken(streamedReply);
    },
    onResult: (data) => { result = data; },
    onError: () => { errored = true; },
  });

  if (errored && !result) return fallbackTurn(studentText, streamedReply);

  const r = result || {};
  return {
    customerReply: (r.customerReply || streamedReply || '嗯。').trim(),
    finished: !!r.finished,
    cites: Array.isArray(r.cites) ? r.cites.filter(c => KP_INDEX[c]) : [],
    quality: ['good', 'mid', 'bad'].includes(r.quality) ? r.quality : 'mid',
    skill: r.skill || '沟通表达',
    feedback: r.feedback || '回应已收到。',
    delta: {
      interest: clamp(+(r.delta?.interest) || 0, -15, 15),
      trust: clamp(+(r.delta?.trust) || 0, -15, 15),
    },
  };
}

function fallbackTurn(studentText, partialReply) {
  // Crude keyword classifier as fallback
  const s = studentText;
  let quality = 'mid', delta = { interest: 2, trust: 0 }, cites = [], skill = '沟通表达';
  if (/(您|理解|场景|平时|怎么用|通勤|长途)/.test(s)) { quality = 'good'; delta = { interest: 8, trust: 10 }; skill = '需求挖掘'; }
  else if (/800V|金砖|麒麟|续航|688|870|自加热|热泵/.test(s)) { quality = 'good'; cites.push('kp1-1'); skill = '产品知识'; delta = { interest: 10, trust: 8 }; }
  else if (/激光雷达|OrinX|浩瀚智驾|FSD/.test(s)) { quality = 'good'; cites.push('kp2-1'); skill = '异议处理'; delta = { interest: 8, trust: 8 }; }
  else if (/优惠|便宜|降价|让一些/.test(s)) { quality = 'bad'; delta = { interest: -4, trust: -8 }; skill = '推进成交'; }
  else if (/放心|相信我|没问题/.test(s)) { quality = 'bad'; delta = { interest: -3, trust: -6 }; }
  return {
    customerReply: (partialReply && partialReply.trim()) || '嗯…你具体说说？',
    finished: false, cites, quality, skill, feedback: '已记录回应。', delta,
  };
}

// ─── Scenario brief — opening mission card ─────────────────
function ScenarioBrief({ t, started, onStart, customer, customers, onPickCustomer, isZheng }) {
  const productMeta = window.SIMUGO_DATA?.PRODUCT?.meta || {};
  const storeContext = productMeta.storeContext || '前滩门店 · 周六下午';
  const storeShort = storeContext.split('·')[0].trim();
  const productName = productMeta.name || '极氪 007';
  const scenarioCode = productMeta.scenarioCode || 'S01';
  const scenarioGoals = productMeta.scenarioGoals || ['识别需求', '化解顾虑', '推进试驾'];
  const scenarioBrief = productMeta.scenarioBrief || '';
  const goalsLabel = scenarioGoals.map(g => `· ${g}`).join(' ');
  const [expanded, setExpanded] = useState(false);

  // ── Collapsed pill once conversation has begun ──────────
  if (started) {
    return (
      <div style={{ marginBottom: 6 }}>
        <div
          onClick={() => setExpanded(e => !e)}
          style={{
            ...neuFlat(t, 999),
            padding: '7px 10px 7px 8px',
            display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer',
            background: `linear-gradient(135deg, ${t.surface}, ${t.surface2})`,
            transition: 'all .25s ease',
          }}
        >
          <div style={{
            width: 20, height: 20, borderRadius: 6,
            background: t.accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 800, flexShrink: 0,
            boxShadow: `1px 1px 2px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
          }}>◆</div>
          <span style={{ fontSize: 10, fontWeight: 700, color: t.accent, letterSpacing: '0.1em', flexShrink: 0 }}>{scenarioCode}</span>
          <div style={{ width: 1, height: 12, background: t.line, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text, flexShrink: 0 }}>{storeShort}</span>
          <span style={{ fontSize: 11, color: t.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {' '}{goalsLabel}
          </span>
          <span style={{ display: 'inline-flex', transform: expanded ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .2s', flexShrink: 0 }}>
            <Icon name="arrow" size={11} color={t.textMute} />
          </span>
        </div>

        {expanded && (
          <div style={{
            ...neuFlat(t, 14),
            marginTop: 8, padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 8,
            animation: 'briefExpand .25s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, letterSpacing: '0.1em' }}>训练场景 · {scenarioCode}</span>
              <span style={{ fontSize: 10, color: t.textMute, fontWeight: 600 }}>{productName}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{storeContext}</div>
            <div style={{ fontSize: 12, color: t.textSoft, lineHeight: 1.6 }}>
              {scenarioBrief}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {scenarioGoals.map((g, i) => (
                <span key={i} style={{
                  fontSize: 10.5, padding: '3px 9px', borderRadius: 999,
                  background: `${t.accent}15`, color: t.accent, fontWeight: 600,
                }}>{i + 1}. {g}</span>
              ))}
            </div>
            <style>{`@keyframes briefExpand{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>
          </div>
        )}
      </div>
    );
  }

  // ── Full opening card (pre-start) ──────────────────────
  return (
    <div style={{
      ...neuRaised(t, 22, 1.1),
      padding: '18px 18px 16px',
      background: `linear-gradient(155deg, ${t.surface} 0%, ${t.surface2} 100%)`,
      transition: 'all .35s ease',
      marginBottom: 6,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Decorative corner accent */}
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 88, height: 88,
        background: `radial-gradient(circle at 100% 0%, ${t.accent}18, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 7,
          background: t.accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, flexShrink: 0,
          boxShadow: `1px 1px 2px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
        }}>◆</div>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, letterSpacing: '0.12em' }}>训练场景 · {scenarioCode}</span>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${t.accent}30, transparent)` }} />
        <span style={{ fontSize: 10, color: t.textMute, fontWeight: 600 }}>{productName}</span>
      </div>

      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 10, lineHeight: 1.4 }}>
        {storeContext}
      </div>

      {!started && (
        <>
          {/* 客户选择 */}
          {customers && customers.length > 1 && (
            <Section t={t} label="选择今日客户">
              <div style={{ display: 'flex', gap: 7 }}>
                {customers.map(c => {
                  const active = c.id === customer.id;
                  return (
                    <div key={c.id} onClick={() => onPickCustomer(c.id)} style={{
                      flex: 1, padding: '10px 6px 9px', borderRadius: 12,
                      cursor: 'pointer', textAlign: 'center',
                      background: active ? `linear-gradient(135deg, ${t.accent}18, ${t.surface})` : t.surface,
                      boxShadow: active
                        ? `2.5px 2.5px 6px ${t.sDark}, -1.5px -1.5px 4px ${t.sLight}, inset 0 0 0 1.5px ${t.accent}`
                        : `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`,
                      transition: 'all .2s ease',
                    }}>
                      <div style={{ fontSize: 18, marginBottom: 2 }}>{c.emoji}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: active ? t.text : t.textSoft, lineHeight: 1.1 }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 9.5, color: active ? t.accent : t.textMute, marginTop: 2, fontWeight: 600 }}>
                        {c.vibe}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!isZheng && (
                <div style={{
                  marginTop: 10, padding: '9px 11px', borderRadius: 10,
                  background: `${t.warn}12`,
                  fontSize: 11.5, color: t.text, lineHeight: 1.55,
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}>
                  <span style={{ color: t.warn, fontWeight: 700 }}>⚡ 实验模式 ·</span>
                  <span style={{ color: t.textSoft }}>
                    该客户暂无完整剧本，全程由 AI 自由扮演 · 没有弹药条提示，更接近真实接待
                  </span>
                </div>
              )}
            </Section>
          )}

          {/* Situation narrative */}
          <Section t={t} label="情境">
            <div style={{ fontSize: 13, color: t.text, lineHeight: 1.7 }}>
              {isZheng ? (
                <>一位客人背着电脑包走进展厅，正在环顾四周的展车，眼神在车型间快速移动。他看了下手机，又抬头看向 007。
                  <span style={{ color: t.textSoft }}> 你注意到他袖口贴着"特斯拉体验中心"的访客贴。</span>
                </>
              ) : (
                <>{customer.context}。<span style={{ color: t.textSoft }}>{customer.motivation}</span></>
              )}
            </div>
          </Section>

          {/* Your task */}
          <Section t={t} label="你的任务">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                '主动开启对话，建立信任',
                '识别客户的真实用车场景与顾虑',
                '把课程知识点用到对话中，化解顾虑',
                '推进到试驾邀约',
              ].map((g, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 999,
                    background: t.surface, color: t.accent,
                    boxShadow: `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1,
                  }}>{i + 1}</div>
                  <span style={{ fontSize: 13, color: t.text, lineHeight: 1.5 }}>{g}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Evaluation criteria — small inline */}
          <div style={{
            marginTop: 14, padding: '10px 12px',
            ...neuInset(t, 12, 0.5),
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="chart" size={12} color={t.textSoft} stroke={1.8} />
              <span style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.08em' }}>评估</span>
            </div>
            {[
              ['产品知识', 35], ['异议处理', 30], ['需求挖掘', 20], ['沟通', 15],
            ].map(([k, v]) => (
              <span key={k} style={{ fontSize: 11, color: t.textSoft }}>
                <b style={{ color: t.text, fontWeight: 700 }}>{k}</b> <span style={{ fontVariantNumeric: 'tabular-nums', color: t.accent }}>{v}%</span>
              </span>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={onStart}
            style={{
              marginTop: 16, width: '100%', height: 48, border: 0, borderRadius: 14,
              background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
              color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: `4px 4px 10px ${t.sDark}, -2px -2px 6px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Icon name="play" size={14} color="#fff" />
            {isZheng ? '开始接待' : `接待 ${customer.name}`}
          </button>
          <div style={{ fontSize: 10.5, color: t.textMute, textAlign: 'center', marginTop: 10, lineHeight: 1.4 }}>
            {isZheng
              ? '演练全程由 AI 实时扮演客户 · 卡住时可点击底部 ✦ 查看回应思路'
              : 'AI 将以 ' + customer.name + ' 的人设回应你 · 直接打字与客户对话'}
          </div>
        </>
      )}

    </div>
  );
}

function Section({ t, label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  );
}

// ─── Customer avatar with mood-driven face ─────────────────
function CustomerAvatar({ t, mood, thinking }) {
  const happy = (mood.interest + mood.trust) / 2;
  const mouthY = 36 + (50 - happy) * 0.08;
  const mouthCurve = -((happy - 50) * 0.22);
  const browTilt = (50 - mood.trust) * 0.04;
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 999,
      background: `radial-gradient(circle at 35% 30%, ${t.accentSoft}, ${t.accent})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `3px 3px 8px ${t.sDark}, -2px -2px 6px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.25)`,
      color: '#fff', position: 'relative', flexShrink: 0,
    }}>
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ position: 'absolute', inset: 0 }}>
        <ellipse cx="18" cy="22" rx="1.8" ry={thinking ? 0.8 : 2.2} fill="#fff" />
        <ellipse cx="30" cy="22" rx="1.8" ry={thinking ? 0.8 : 2.2} fill="#fff" />
        <path d={`M14 ${17 + browTilt} L22 ${17 - browTilt}`} stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={`M26 ${17 - browTilt} L34 ${17 + browTilt}`} stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={`M18 ${mouthY} Q24 ${mouthY + mouthCurve} 30 ${mouthY}`} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

function MoodBar({ t, label, value, color, icon }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <Icon name={icon} size={11} color={color} stroke={1.8} />
          <span style={{ fontSize: 11, color: t.textSoft, fontWeight: 600 }}>{label}</span>
        </div>
        <span style={{ fontSize: 11, color: t.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Math.round(value)}</span>
      </div>
      <div style={{ height: 5, ...neuInset(t, 999, 0.4), position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${value}%`, background: color, transition: 'width .5s cubic-bezier(.22,.61,.36,1)',
          boxShadow: `0 0 8px ${color}80`,
        }} />
      </div>
    </div>
  );
}

// ─── Chat bubbles ──────────────────────────────────────────
function ChatBubble({ t, m }) {
  if (m.role === 'system') {
    return (
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        <span style={{ fontSize: 11.5, color: t.textMute, padding: '5px 12px', borderRadius: 999, background: `${t.surface2}90` }}>{m.text}</span>
      </div>
    );
  }
  if (m.role === 'customer') {
    return (
      <div style={{ maxWidth: '82%', alignSelf: 'flex-start' }}>
        <div style={{
          background: t.surface, borderRadius: '4px 18px 18px 18px',
          boxShadow: `3px 3px 8px ${t.sDark}, -2px -2px 6px ${t.sLight}`,
          padding: '12px 14px', color: t.text, fontSize: 14, lineHeight: 1.55,
        }}>{m.text}</div>
        {m.sub && <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 4, marginLeft: 4, fontStyle: 'italic' }}>{m.sub}</div>}
      </div>
    );
  }
  // student
  const qc = m.quality === 'good' ? t.good : m.quality === 'bad' ? t.bad : m.quality === 'pending' ? t.textMute : t.warn;
  return (
    <div style={{ maxWidth: '82%', alignSelf: 'flex-end' }}>
      <div style={{
        background: `linear-gradient(135deg, ${t.accent}, ${t.accent}dd)`,
        color: '#fff', borderRadius: '18px 4px 18px 18px',
        padding: '12px 14px', fontSize: 14, lineHeight: 1.55,
        boxShadow: `3px 3px 8px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.18)`,
      }}>{m.text}</div>
      {m.cites && m.cites.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {m.cites.map(c => {
            const ref = window.SIMUGO_DATA.KP_INDEX[c];
            if (!ref) return null;
            return <span key={c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: `${qc}25`, color: qc, fontWeight: 600 }}>▸ {ref.point.title}</span>;
          })}
        </div>
      )}
    </div>
  );
}

function ThinkingDots({ t }) {
  return (
    <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '12px 14px', background: t.surface, borderRadius: '4px 18px 18px 18px', boxShadow: `2px 2px 6px ${t.sDark}, -2px -2px 4px ${t.sLight}` }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: 999, background: t.textMute,
          animation: `dotBounce 1.2s ${i * 0.15}s infinite ease-in-out`,
        }} />
      ))}
      <style>{`@keyframes dotBounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}`}</style>
    </div>
  );
}

function KnowledgePopup({ t, kpId }) {
  const ref = window.SIMUGO_DATA.KP_INDEX[kpId];
  if (!ref) return null;
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      ...neuRaised(t, 16, 1.4),
      padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'kpPop 2.2s ease',
      zIndex: 5,
      background: `linear-gradient(135deg, ${t.surface}, ${t.surface2})`,
      maxWidth: 'calc(100% - 32px)',
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: t.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="sparkle" size={16} color="#fff" stroke={1.8} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.1em' }}>知识点已调用</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref.point.title}</div>
      </div>
      <style>{`@keyframes kpPop{0%{opacity:0;transform:translateX(-50%) translateY(-8px)}10%{opacity:1;transform:translateX(-50%) translateY(0)}85%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-4px)}}`}</style>
    </div>
  );
}

// ─── Bottom bar: hints + input ─────────────────────────────
function BottomBar({ t, input, setInput, onSend, showHints, setShowHints, hints, onPickHint, onOpenLibrary, autoPath, disabled, started }) {
  const inputRef = useRef(null);
  return (
    <div style={{ background: t.bg, borderTop: `1px solid ${t.line}` }}>
      {showHints && (
        <div style={{ padding: '12px 16px 8px', maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="spark" size={13} color={t.accent} stroke={2} />
              <span style={{ fontSize: 11, color: t.accent, fontWeight: 700, letterSpacing: '0.06em' }}>回应思路提示</span>
            </div>
            <span style={{ fontSize: 10, color: t.textMute }}>点击思路填入输入框</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hints.map(opt => (
              <div key={opt.id} onClick={() => onPickHint(opt)} style={{
                ...neuFlat(t, 14), padding: '10px 12px', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, letterSpacing: '0.04em' }}>{opt.label}</span>
                  <span style={{ fontSize: 9.5, color: t.textMute }}>{opt.skill}</span>
                </div>
                <div style={{ fontSize: 12.5, color: t.textSoft, lineHeight: 1.5 }}>{opt.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: '10px 14px 18px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        <button
          onClick={onOpenLibrary}
          disabled={!started}
          style={{
            width: 42, height: 42, borderRadius: 999, border: 0, flexShrink: 0,
            background: t.surface, color: t.accent,
            cursor: started ? 'pointer' : 'not-allowed',
            opacity: started ? 1 : 0.5,
            boxShadow: `3px 3px 6px ${t.sDark}, -2px -2px 4px ${t.sLight}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="知识弹药库"
        >
          <Icon name="book" size={18} color={t.accent} stroke={1.8} />
        </button>
        <button
          onClick={() => setShowHints(s => !s)}
          style={{
            width: 42, height: 42, borderRadius: 999, border: 0, cursor: 'pointer', flexShrink: 0,
            background: showHints ? t.accent : t.surface,
            color: showHints ? '#fff' : t.accent,
            boxShadow: showHints
              ? `inset 2px 2px 4px ${t.sDark}, inset -2px -2px 4px ${t.sLight}`
              : `3px 3px 6px ${t.sDark}, -2px -2px 4px ${t.sLight}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="回应思路提示"
        >
          <Icon name="spark" size={18} color={showHints ? '#fff' : t.accent} stroke={2} />
        </button>
        <div style={{
          flex: 1, ...neuInset(t, 22, 0.7),
          padding: '4px 6px 4px 14px', display: 'flex', alignItems: 'flex-end', gap: 6,
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder={!started ? '点击上方"开始接待"开启对话…' : autoPath !== 'manual' ? `演示自动模式（${autoPath === 'good' ? '好回答' : '差回答'}）…` : '对客户说点什么…'}
            disabled={autoPath !== 'manual' || disabled}
            rows={1}
            style={{
              flex: 1, border: 0, background: 'transparent', outline: 'none',
              padding: '11px 0', fontSize: 14, color: t.text, fontFamily: 'inherit',
              resize: 'none', maxHeight: 80, lineHeight: 1.5,
            }}
          />
          <button
            onClick={onSend}
            disabled={autoPath !== 'manual' || disabled || !input.trim()}
            style={{
              width: 34, height: 34, borderRadius: 999, border: 0,
              background: t.accent, color: '#fff',
              cursor: input.trim() && !disabled ? 'pointer' : 'not-allowed',
              opacity: input.trim() && !disabled ? 1 : 0.35,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `2px 2px 4px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
              marginBottom: 3,
            }}
          >
            <Icon name="arrow" size={16} color="#fff" stroke={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customer profile bottom sheet ─────────────────────────
function CustomerProfileSheet({ t, customer, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 50, display: 'flex', alignItems: 'flex-end',
      animation: 'sheetFadeIn .2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bg, width: '100%',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: '12px 20px 28px',
        maxHeight: '85%', overflowY: 'auto',
        boxShadow: `0 -10px 30px rgba(0,0,0,0.2)`,
        animation: 'sheetSlideUp .28s cubic-bezier(.22,.61,.36,1)',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 14px' }}>
          <div style={{ width: 42, height: 5, borderRadius: 999, background: t.textMute, opacity: 0.4 }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 999,
            background: `radial-gradient(circle at 35% 30%, ${t.accentSoft}, ${t.accent})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 26, fontWeight: 700,
            boxShadow: `4px 4px 10px ${t.sDark}, -3px -3px 8px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.25)`,
          }}>{customer.avatar}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: t.text }}>{customer.name}</div>
            <div style={{ fontSize: 12, color: t.accent, fontWeight: 600, marginTop: 4 }}>{customer.tagline}</div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, border: 0, borderRadius: 999,
            background: t.surface, cursor: 'pointer',
            boxShadow: `2px 2px 4px ${t.sDark}, -2px -2px 4px ${t.sLight}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="close" size={16} color={t.textSoft} />
          </button>
        </div>

        {/* Basic info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            ['年龄', `${customer.age} 岁`],
            ['职业', customer.job],
            ['预算', customer.budget],
            ['家庭', customer.family],
            ['居住', customer.city, true],
          ].map(([k, v, full], i) => (
            <div key={i} style={{ ...neuFlat(t, 12), padding: '10px 12px', gridColumn: full ? '1 / -1' : 'auto' }}>
              <div style={{ fontSize: 10, color: t.textMute, fontWeight: 600, letterSpacing: '0.05em' }}>{k}</div>
              <div style={{ fontSize: 13, color: t.text, fontWeight: 600, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Motivation */}
        <ProfileSection t={t} title="来店动机" icon="route">
          <div style={{ fontSize: 13, color: t.text, lineHeight: 1.65 }}>{customer.motivation}</div>
        </ProfileSection>

        {/* Personality */}
        <ProfileSection t={t} title="性格特征" icon="user">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {customer.personality.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: t.text, lineHeight: 1.5 }}>
                <span style={{ color: t.accent, flexShrink: 0 }}>·</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </ProfileSection>

        {/* Concerns */}
        <ProfileSection t={t} title="核心顾虑" icon="target">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {customer.concerns.map((c, i) => (
              <div key={i} style={{ ...neuFlat(t, 12), padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: t.accent,
                    padding: '2px 8px', borderRadius: 999,
                    background: `${t.accent}15`, letterSpacing: '0.04em',
                  }}>{c.tag}</span>
                </div>
                <div style={{ fontSize: 12.5, color: t.textSoft, lineHeight: 1.5 }}>{c.detail}</div>
              </div>
            ))}
          </div>
        </ProfileSection>

        <style>{`
          @keyframes sheetFadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes sheetSlideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        `}</style>
      </div>
    </div>
  );
}

function ProfileSection({ t, title, icon, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '0 2px' }}>
        <Icon name={icon} size={13} color={t.accent} stroke={1.8} />
        <span style={{ fontSize: 11, fontWeight: 700, color: t.textSoft, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export { PracticeScreen };
