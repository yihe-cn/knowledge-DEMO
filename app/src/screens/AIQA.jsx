// screens-ai-qa.jsx — AI 答疑：员工学习阶段的产品私教
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";
import { QuizMode } from "./AIQuiz.jsx";
import { streamChat } from "../lib/llmClient.js";

// ─── 把知识库压缩成紧凑结构，发送给后端 ─────────────────────────
function buildCompactKnowledge(KNOWLEDGE) {
  return KNOWLEDGE.map(m => ({
    id: m.id, title: m.title,
    points: m.points.map(p => ({
      id: p.id, title: p.title,
      spec: p.spec, sales: p.sales,
      customerVoice: p.customerVoice,
      rebuttals: (p.rebuttals || []).map(r => ({ q: r.q, a: r.approach })),
    })),
  }));
}

// ─── 起手提示词 ────────────────────────────────────────────────
// 入口 A：从某个知识点进入（contextual）
function contextStarters(kp) {
  return [
    `用大白话把"${kp.title}"再讲一遍`,
    `客户如果质疑这点，怎么回？`,
    `这个怎么用在对话里？举个例子`,
  ];
}
// 入口 B：全局进入（无上下文）—— 每个产品定义自己的起手提示。
// 优先级：product.meta.aiqaStarters（后端/admin 维护）→ 静态默认（已知产品）→
// 从首批 KP 标题自动派生（动态产品兜底）→ 通用兜底（连 KP 都没有）
const DEFAULT_STARTERS = {
  zeekr007: [
    '客户刚从特斯拉店出来，怎么开场？',
    '北方客户问冬季续航怎么应对？',
    '一句话讲清 800V 的好处',
    '智驾对比 FSD 怎么讲不踩雷？',
  ],
  pax: [
    'KOL 主任问"你们和其他抗反流配方差异化在哪"，怎么开场？',
    '医生质疑双歧杆菌数据 p 值不显著，怎么接？',
    '一句话讲清淀粉-果胶复合物的协同机制',
    'CMA 患儿伴反流场景，怎么推 Allernova AR？',
  ],
};
function getGlobalStarters() {
  const product = window.SIMUGO_DATA?.PRODUCT;
  if (!product) return [];
  const fromMeta = product.meta?.aiqaStarters;
  if (Array.isArray(fromMeta) && fromMeta.length) return fromMeta.slice(0, 4);
  if (DEFAULT_STARTERS[product.id]) return DEFAULT_STARTERS[product.id];
  // 动态产品：取前两个知识点标题派生 starter
  const knowledge = window.SIMUGO_DATA?.KNOWLEDGE || [];
  const kps = [];
  for (const m of knowledge) {
    for (const p of m.points) {
      kps.push(p);
      if (kps.length >= 2) break;
    }
    if (kps.length >= 2) break;
  }
  const productName = product.meta?.name || '这门课';
  if (kps.length === 0) {
    return [
      `${productName}主要讲什么？`,
      '列三个最该先掌握的知识点',
      '客户最容易问倒的点是什么？',
    ];
  }
  const out = [`用大白话讲讲"${kps[0].title}"`];
  if (kps[1]) out.push(`举个例子怎么用"${kps[1].title}"`);
  out.push(`${productName}最容易被客户问倒的点是？`);
  out.push('给我一个开场白模板');
  return out;
}

// ─── 后端 QA 流水线节点的展示元数据 ───────────────────────────
// 顺序必须与 server/app/graphs/qa_graph.py 中节点编排一致
const QA_STAGES = [
  { node: 'planner',     running: '正在理解问题…',   done: '理解问题' },
  { node: 'retriever',   running: '正在检索知识库…', done: '检索知识库' },
  { node: 'reranker',    running: '正在排序相关性…', done: '排序相关性' },
  { node: 'synthesizer', running: '正在组织答案…',   done: '组织答案' },
];
const INITIAL_STAGE_STATE = { currentIdx: 0, durations: {} };

// ─── 主屏 ──────────────────────────────────────────────────────
function AIQAScreen({ t, go, contextKpId, setContextKpId, initialMode, tweaks }) {
  const { KP_INDEX } = window.SIMUGO_DATA;
  const contextKp = contextKpId ? KP_INDEX[contextKpId] : null;
  const [mode, setMode] = useState(initialMode || 'chat'); // 'chat' | 'quiz'
  const showStageTiming = !!(tweaks && tweaks.showStageTiming);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <TopBar t={t} title="AI 答疑 · 产品私教" onBack={() => go('home')} />
      <ModeSwitch t={t} mode={mode} onChange={setMode} />
      {mode === 'chat'
        ? <ChatMode key="chat" t={t} contextKp={contextKp} setContextKpId={setContextKpId} showStageTiming={showStageTiming} />
        : <QuizMode key="quiz" t={t} contextKp={contextKp} setContextKpId={setContextKpId} />
      }
    </div>
  );
}

// ─── 模式切换（segmented） ─────────────────────────────────────
function ModeSwitch({ t, mode, onChange }) {
  const opts = [
    { v: 'chat', icon: 'chat', label: '问 AI', sub: '想啥问啥' },
    { v: 'quiz', icon: 'bolt', label: 'AI 考我', sub: '客户突击 5 题' },
  ];
  return (
    <div style={{ padding: '0 18px 12px' }}>
      <div style={{
        ...neuInset(t, 18, 0.7), padding: 4,
        display: 'flex', gap: 4,
      }}>
        {opts.map(o => {
          const active = mode === o.v;
          return (
            <div key={o.v} onClick={() => onChange(o.v)} style={{
              flex: 1, padding: '9px 8px', borderRadius: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              background: active
                ? `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`
                : 'transparent',
              boxShadow: active
                ? `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)`
                : 'none',
              transition: 'all .2s ease',
            }}>
              <Icon name={o.icon} size={14} color={active ? '#fff' : t.textSoft} stroke={2} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#fff' : t.text, lineHeight: 1.1 }}>{o.label}</div>
                <div style={{ fontSize: 9.5, color: active ? 'rgba(255,255,255,0.7)' : t.textMute, marginTop: 2, letterSpacing: '0.02em' }}>{o.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 聊天模式 ──────────────────────────────────────────────────
function ChatMode({ t, contextKp, setContextKpId, showStageTiming }) {
  const { KNOWLEDGE, KP_INDEX } = window.SIMUGO_DATA;
  const COMPACT_KB = useMemo(() => buildCompactKnowledge(KNOWLEDGE), [KNOWLEDGE]);
  const PRODUCT_META = window.SIMUGO_DATA?.PRODUCT?.meta || {};

  const [messages, setMessages] = useState([]);    // {role:'user'|'ai', text, citations?, followups?}
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [stageState, setStageState] = useState(INITIAL_STAGE_STATE);
  const [openKpId, setOpenKpId] = useState(null);  // KP detail modal
  const [starredIds, setStarredIds] = useState(() => {
    // S9：进入屏幕时读一次已收藏 message id，避免每次按按钮都走 localStorage
    if (typeof window === 'undefined' || !window.SIMUGO_NOTES) return new Set();
    const all = window.SIMUGO_NOTES.load();
    return new Set(all.filter(n => n.type === 'starred' && n.messageId).map(n => n.messageId));
  });
  const [toast, setToast] = useState(null); // {text, kind}
  const toastTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const sessionIdRef = useRef(`n-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const sendingRef = useRef(false);  // 同步守卫，避免 setState 异步窗口被快速双击穿透

  const showToast = useCallback((text, kind = 'good') => {
    setToast({ text, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // S9：收藏/取消收藏单条 AI 回答 + 它对应的用户提问
  const toggleStar = useCallback((aiMsg, userText) => {
    if (!window.SIMUGO_NOTES || !aiMsg?.id) return;
    if (starredIds.has(aiMsg.id)) {
      window.SIMUGO_NOTES.unstar(aiMsg.id);
      setStarredIds(s => { const n = new Set(s); n.delete(aiMsg.id); return n; });
      showToast('已取消收藏', 'mute');
    } else {
      window.SIMUGO_NOTES.star({
        messageId: aiMsg.id,
        question: userText || '',
        answer: aiMsg.text || '',
        contextKpId: contextKp ? contextKp.point.id : null,
        ragCitations: aiMsg.ragCitations,
        citations: aiMsg.citations,
        taggedKps: aiMsg.taggedKps,
      });
      setStarredIds(s => new Set(s).add(aiMsg.id));
      showToast('已加入笔记 · 收藏', 'good');
    }
    window.notifyNotesChanged && window.notifyNotesChanged();
  }, [starredIds, contextKp, showToast]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const starters = contextKp ? contextStarters(contextKp.point) : getGlobalStarters();

  const send = useCallback(async (text) => {
    const q = (text || '').trim();
    if (!q || thinking || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');

    // 上下文注入：让模型知道学员当前在学什么
    let userPayload = q;
    if (contextKp && messages.length === 0) {
      userPayload = `[学员正在学习的知识点：${contextKp.module.title} · ${contextKp.point.title}（${contextKp.point.id}）]\n\n${q}`;
    }

    // AI 消息分配稳定 id：result/followups 事件按 id 定位，避免用户在
    // followups 还没回来时发起新对话导致 patch 错位
    const aiMsgId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next = [...messages, { role: 'user', text: q }];
    // 先在消息列表里插入一条空的 AI 消息，token 流入后逐步填充
    setMessages([...next, { id: aiMsgId, role: 'ai', text: '', citations: [], followups: [], ragCitations: [], taggedKps: [], streaming: true }]);
    setThinking(true);
    setStageState(INITIAL_STAGE_STATE);

    // 临时收集 RAG 事件
    let ragCitations = [];
    let taggedKps = [];
    let fallbackReason = '';  // 非空 = verifier 拒绝了原答案
    let answerMode = 'kb';    // 后端通过 answer_mode 事件告知；'experience' = AI 凭经验回答
    let resultArrived = false;  // 标记 result 事件是否到达，错误路径用
    const patchLastAi = (patch) => {
      setMessages(m => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === 'ai' && last.streaming) {
          copy[copy.length - 1] = { ...last, ...patch };
        }
        return copy;
      });
    };
    // 按 id 定位并 patch 消息：onResult/onFollowups 用，因为这时用户可能已经
    // 发起了新对话（sendingRef 在 onResult 中清掉），最后一条不一定是目标
    const patchMsgById = (id, patch) => {
      setMessages(m => {
        const idx = m.findIndex(x => x.id === id);
        if (idx < 0) return m;
        const copy = [...m];
        copy[idx] = { ...copy[idx], ...patch };
        persistNotes(copy);
        return copy;
      });
    };
    const persistNotes = (msgs) => {
      if (window.SIMUGO_NOTES) {
        window.SIMUGO_NOTES.upsert({
          id: sessionIdRef.current, type: 'chat',
          contextKpId: contextKp ? contextKp.point.id : null,
          messages: msgs,
        });
        window.notifyNotesChanged && window.notifyNotesChanged();
      }
    };

    const apiMessages = next.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.role === 'user' ? (m === next[next.length - 1] ? userPayload : m.text) : m.text,
    }));

    let streamed = '';
    let resultMeta = null;
    let errorMessage = '';

    try {
      await streamChat({
      endpoint: '/api/qa',
      body: {
        product_id: window.SIMUGO_DATA?.PRODUCT?.id,
        product_meta: PRODUCT_META,
        knowledge: COMPACT_KB,
        messages: apiMessages,
      },
      onToken: (text) => {
        streamed += text;
        setMessages(m => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === 'ai' && last.streaming) {
            copy[copy.length - 1] = { ...last, text: streamed };
          }
          return copy;
        });
      },
      onResult: (data) => {
        resultMeta = data || {};
        resultArrived = true;
        // result 到达即视为「主回答完成」：定稿消息 + 解锁输入框，
        // followups 走单独事件后补，不阻塞用户继续提问
        const rawCitations = resultMeta?.citations;
        // 后端在 result 里给的是「答案真正引用到的 chunks」的权威列表,
        // 空数组也是合法终态(verifier fallback 文本通常不含 [n]),
        // 不再回退到流式阶段缓存的全量 ragCitations。
        const isObjectArray = Array.isArray(rawCitations)
          && (rawCitations.length === 0 || typeof rawCitations[0] === 'object');
        const ragCites = isObjectArray ? rawCitations : ragCitations;
        const legacyCites = Array.isArray(rawCitations) && rawCitations.length && typeof rawCitations[0] === 'string'
          ? rawCitations.filter(id => KP_INDEX[id])
          : [];
        const finalTaggedKps = resultMeta?.tagged_kps || taggedKps;
        const finalMode = resultMeta?.answer_mode || answerMode || 'kb';
        patchMsgById(aiMsgId, {
          streaming: false,
          text: (resultMeta?.answer || streamed || '（这个问题我没想清楚，能换种说法吗？）').trim(),
          rawAnswer: resultMeta?.raw_answer || null,
          fallbackReason,
          answerMode: finalMode,
          // 经验模式专属：rerank 排第一的 chunk + 其 KP，用作"系统找到的最接近材料"
          closestMatch: resultMeta?.closest_match || null,
          citations: legacyCites,
          ragCitations: ragCites,
          taggedKps: finalTaggedKps,
          followups: (resultMeta?.followups || []).slice(0, 3),  // 通常为空，等 followups 事件
        });
        setThinking(false);
        sendingRef.current = false;
      },
      onFollowups: (items) => {
        patchMsgById(aiMsgId, { followups: (items || []).slice(0, 3) });
      },
      onCitations: (items) => {
        ragCitations = items || [];
        patchLastAi({ ragCitations });
      },
      onTaggedKps: (items) => {
        taggedKps = items || [];
        patchLastAi({ taggedKps });
      },
      onFallback: (data) => {
        fallbackReason = (data && data.reason) || 'verifier_failed';
      },
      onAnswerMode: (mode) => {
        answerMode = mode || 'kb';
        patchLastAi({ answerMode: answerMode });
      },
      onStage: ({ node, duration_ms }) => {
        // experience_synthesizer 与 synthesizer 在 UI 上共用最后一格
        const stageNode = node === 'experience_synthesizer' ? 'synthesizer' : node;
        setStageState(s => {
          const idx = QA_STAGES.findIndex(x => x.node === stageNode);
          if (idx < 0) return s;
          return {
            // 取 max 防止事件乱序时进度回退；当前线性图不会乱，但兜底零成本
            currentIdx: Math.max(s.currentIdx, idx + 1),
            durations: { ...s.durations, [stageNode]: duration_ms },
          };
        });
      },
      onError: (err) => {
        errorMessage = err?.message || 'AI 服务暂时不可用';
      },
      onDone: () => {},
    });

    // 兜底：result 事件没到（异常断流 / 后端错误），手动定稿为错误消息
    if (!resultArrived) {
      setMessages(m => {
        const idx = m.findIndex(x => x.id === aiMsgId);
        if (idx < 0) return m;
        const copy = [...m];
        copy[idx] = {
          id: aiMsgId,
          role: 'ai',
          text: errorMessage && !streamed
            ? formatAIQAError(errorMessage)
            : (streamed || '（这次没拿到完整回答，可以再试一次）').trim(),
          citations: [],
          followups: [],
        };
        persistNotes(copy);
        return copy;
      });
    }
    setThinking(false);
    } finally {
      sendingRef.current = false;
    }
  }, [messages, thinking, contextKp, COMPACT_KB, PRODUCT_META, KP_INDEX]);

  const clearContext = () => setContextKpId(null);
  const resetChat = () => {
    setMessages([]);
    sessionIdRef.current = `n-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  };
  const lastMessage = messages[messages.length - 1];
  const showThinkingBubble = thinking && !(
    lastMessage?.role === 'ai' &&
    lastMessage?.streaming &&
    lastMessage?.text
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {/* 上下文芯片 */}
      {contextKp && (
        <div style={{ padding: '0 18px 8px' }}>
          <div style={{
            ...neuFlat(t, 999), padding: '8px 8px 8px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            background: `linear-gradient(135deg, ${t.accent}18, ${t.accentSoft}10)`,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: 999, background: t.accent,
              boxShadow: `0 0 0 4px ${t.accent}22`,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.1em' }}>正在讨论</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginTop: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {contextKp.module.icon} {contextKp.point.title}
              </div>
            </div>
            <div onClick={clearContext} style={{
              width: 26, height: 26, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', background: t.surface2,
              boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
            }}>
              <Icon name="close" size={12} color={t.textSoft} stroke={2.2} />
            </div>
          </div>
        </div>
      )}

      {/* 主区域：空态 or 对话 */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '4px 18px 12px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {messages.length === 0 ? (
          <EmptyState t={t} contextKp={contextKp} starters={starters} onPick={send} />
        ) : (
          <>
            {messages.map((m, i) => {
              // 找到本条 AI 消息对应的用户提问（往前回溯第一条 user 消息）
              let prevUser = null;
              if (m.role === 'ai') {
                for (let j = i - 1; j >= 0; j--) {
                  if (messages[j].role === 'user') { prevUser = messages[j].text; break; }
                }
              }
              return (
                <Bubble key={i} t={t} msg={m}
                  onCiteClick={(id) => setOpenKpId(id)}
                  onFollowup={send}
                  starred={m.id ? starredIds.has(m.id) : false}
                  onToggleStar={() => toggleStar(m, prevUser)}
                />
              );
            })}
            {showThinkingBubble && <ThinkingBubble t={t} stages={QA_STAGES} state={stageState} showStageTiming={showStageTiming} />}
          </>
        )}
      </div>

      {/* 输入栏 */}
      <Composer t={t} value={input} onChange={setInput} onSend={() => send(input)} disabled={thinking} />

      {/* 浮动"新对话"按钮 */}
      {messages.length > 0 && (
        <div onClick={resetChat} style={{
          position: 'absolute', top: 6, right: 18, zIndex: 5,
          ...neuRaised(t, 999), padding: '6px 11px', cursor: 'pointer',
          fontSize: 11, color: t.textSoft, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <Icon name="refresh" size={11} color={t.textSoft} stroke={2} />
          新对话
        </div>
      )}

      {/* KP 详情弹层 */}
      {openKpId && <KpDetailSheet t={t} kpId={openKpId} onClose={() => setOpenKpId(null)} />}

      {/* S9 toast：收藏/取消收藏反馈，1.6s 自动消失 */}
      {toast && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 86, transform: 'translateX(-50%)',
          zIndex: 60,
          padding: '8px 16px', borderRadius: 999,
          background: toast.kind === 'good' ? t.text : t.surface2,
          color: toast.kind === 'good' ? t.bg : t.textSoft,
          fontSize: 12.5, fontWeight: 600,
          boxShadow: `4px 4px 12px ${t.sDark}, -2px -2px 8px ${t.sLight}`,
          animation: 'simugoToastIn .18s ease',
          pointerEvents: 'none',
        }}>
          {toast.text}
          <style>{`@keyframes simugoToastIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
        </div>
      )}
    </div>
  );
}

// 学员视角的错误文案——不暴露环境变量名/技术细节。
// 真实错误信息打到 console，方便研发自查；学员看到的是"暂时联系不上 / 联系管理员"。
function formatAIQAError(message) {
  const msg = String(message || '').trim();
  if (msg) console.warn('[AIQA] backend error:', msg);
  if (/api[_ -]?key|missing credentials|401|unauthorized/i.test(msg)) {
    return 'AI 答疑暂时不可用，请联系管理员检查配置。';
  }
  if (/failed to fetch|network|load failed|ECONNREFUSED|fetch/i.test(msg)) {
    return 'AI 暂时联系不上，请稍后再试。';
  }
  return 'AI 这次没回上来，可以再试一次或换种说法。';
}

// ─── 空态 ──────────────────────────────────────────────────────
function EmptyState({ t, contextKp, starters, onPick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12 }}>
      {/* 私教头像 */}
      <div style={{
        width: 72, height: 72, borderRadius: 24,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `5px 5px 14px ${t.sDark}, -4px -4px 10px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.25)`,
        marginBottom: 18, position: 'relative',
      }}>
        <Icon name="sparkle" size={32} color="#fff" stroke={2} />
        <div style={{
          position: 'absolute', bottom: -4, right: -4, width: 22, height: 22, borderRadius: 999,
          background: t.good, border: `3px solid ${t.bg}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />
        </div>
      </div>

      <div style={{ fontSize: 19, fontWeight: 700, color: t.text, marginBottom: 6 }}>
        {contextKp ? '我陪你拆这个知识点' : '随时来问产品的事'}
      </div>
      <div style={{ fontSize: 13, color: t.textSoft, textAlign: 'center', maxWidth: 280, lineHeight: 1.55, marginBottom: 24 }}>
        {contextKp
          ? '不懂的、想深挖的、想模拟客户提问，都可以直接问。'
          : `只懂${window.SIMUGO_DATA?.PRODUCT?.meta?.name || '当前产品'}——参数、应答思路、对比话术，挑你想清楚的问。`}
      </div>

      {/* 起手提示 */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.12em', paddingLeft: 4 }}>
          {contextKp ? '从这里开始' : '热门提问'}
        </div>
        {starters.map((s, i) => (
          <div key={i} onClick={() => onPick(s)} style={{
            ...neuFlat(t, 16), padding: '13px 16px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
            transition: 'transform .15s ease',
          }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <div style={{
              width: 26, height: 26, borderRadius: 999, flexShrink: 0,
              background: t.surface2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `inset 1px 1px 2px ${t.sDark}, inset -1px -1px 2px ${t.sLight}`,
            }}>
              <Icon name="spark" size={13} color={t.accent} stroke={2} />
            </div>
            <div style={{ flex: 1, fontSize: 13.5, color: t.text, lineHeight: 1.4 }}>{s}</div>
            <Icon name="arrow" size={14} color={t.textMute} />
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 22, fontSize: 11, color: t.textMute, textAlign: 'center',
        lineHeight: 1.6, maxWidth: 280,
      }}>
        🔒 回答仅限知识库内容 · 不编参数<br/>
        引用来源会以卡片形式呈现，可点击回到课程
      </div>
    </div>
  );
}

// ─── 对话气泡 ──────────────────────────────────────────────────
// 把 hash 文件名兜底成「文档 [n]」,只匹配上传链路使用的 uuid hex (32) + 常见扩展名,
// 避免把合法的长文件名误判成 hash。
function prettyDocName(name, fallbackIndex) {
  if (!name) return `文档 [${fallbackIndex}]`;
  if (/^[0-9a-f]{32}(\.[a-z0-9]{2,5})?$/i.test(name.trim())) return `文档 [${fallbackIndex}]`;
  return name;
}

// 把一段纯文本里的 **xxx** 切成节点数组(保留原顺序)。不跨行、不嵌套。
function parseBold(text, keyPrefix) {
  if (!text) return [];
  const out = [];
  const re = /\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyPrefix}-b-${i++}`}>{m[1]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 渲染答案正文:先按 [n] 切(优先级最高,避免被 **xx [1]** 吞掉),再在每段非角标
// 的文本节点里跑一遍粗体解析。
function renderAnswerText(text, citeMap, activeCite, onCiteClick, t) {
  if (!text) return null;
  const out = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const seg = text.slice(last, m.index);
      out.push(<React.Fragment key={`t-${i++}`}>{parseBold(seg, `t${i}`)}</React.Fragment>);
    }
    const n = Number(m[1]);
    const cite = citeMap[n];
    if (cite) {
      const active = activeCite === n;
      out.push(
        <span
          key={`c-${i++}`}
          onClick={(e) => { e.stopPropagation(); onCiteClick(n); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 18, height: 18, padding: '0 5px', margin: '0 2px',
            borderRadius: 6, cursor: 'pointer',
            background: active ? t.accent : `${t.accent}1f`,
            color: active ? '#fff' : t.accent,
            fontSize: 11, fontWeight: 700, lineHeight: 1,
            verticalAlign: '1px',
            transition: 'all .12s ease',
          }}
        >{n}</span>
      );
    } else {
      out.push(m[0]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    const seg = text.slice(last);
    out.push(<React.Fragment key={`t-${i++}`}>{parseBold(seg, `t${i}`)}</React.Fragment>);
  }
  return out;
}

function Bubble({ t, msg, onCiteClick, onFollowup, starred, onToggleStar }) {
  const [activeCite, setActiveCite] = useState(null);
  // S9：收藏按钮只在 AI 消息完成态（非 streaming、有文本、有稳定 id）出现
  const canStar = msg.role === 'ai' && !msg.streaming && !!msg.text && !!msg.id && typeof onToggleStar === 'function';

  if (msg.role === 'ai' && msg.streaming && !msg.text) return null;

  if (msg.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '82%' }}>
        <div style={{
          padding: '12px 16px', borderRadius: '22px 22px 6px 22px',
          background: t.accent, color: '#fff',
          fontSize: 14.5, lineHeight: 1.55,
          boxShadow: `3px 3px 8px ${t.sDark}, -2px -2px 6px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)`,
          whiteSpace: 'pre-wrap',
        }}>{msg.text}</div>
      </div>
    );
  }
  // AI
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: '94%' }}>
      <div style={{
        width: 32, height: 32, borderRadius: 12, flexShrink: 0, marginTop: 2,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`,
      }}>
        <Icon name="sparkle" size={16} color="#fff" stroke={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          ...neuFlat(t, 18), padding: '12px 14px',
          fontSize: 14, color: t.text, lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          borderTopLeftRadius: 6,
          position: 'relative',
        }}
          onClick={() => activeCite !== null && setActiveCite(null)}
        >
          {(() => {
            const citeMap = {};
            (msg.ragCitations || []).forEach(c => { citeMap[c.index] = c; });
            return renderAnswerText(
              msg.text,
              citeMap,
              activeCite,
              (n) => setActiveCite(prev => prev === n ? null : n),
              t,
            );
          })()}
          {msg.streaming && msg.text && (
            <span style={{ color: t.accent, fontWeight: 700, marginLeft: 2 }}>|</span>
          )}
          {activeCite !== null && (() => {
            const c = (msg.ragCitations || []).find(x => x.index === activeCite);
            if (!c) return null;
            const slidePart = (c.slide_indices && c.slide_indices.length)
              ? ` · p${c.slide_indices.join(',')}`
              : (c.slide_index ? ` · p${c.slide_index}` : '');
            return (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  marginTop: 10, padding: '10px 12px', borderRadius: 12,
                  background: t.surface2,
                  boxShadow: `inset 2px 2px 4px ${t.sDark}, inset -2px -2px 4px ${t.sLight}`,
                  fontSize: 12, color: t.textSoft, lineHeight: 1.55,
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, borderRadius: 6, background: t.accent, color: '#fff',
                    fontSize: 10, fontWeight: 700,
                  }}>{c.index}</span>
                  <span style={{ fontWeight: 700, color: t.text, fontSize: 12.5 }}>
                    {prettyDocName(c.doc_name, c.index)}{slidePart}
                  </span>
                  <span
                    onClick={() => setActiveCite(null)}
                    style={{
                      marginLeft: 'auto', width: 20, height: 20, borderRadius: 999,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: t.textMute, fontSize: 14, lineHeight: 1,
                    }}
                  >×</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: t.textSoft }}>{c.snippet}</div>
              </div>
            );
          })()}
        </div>

        {/* S9：收藏按钮——AI 完整回答出来后才显示 */}
        {canStar && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
              title={starred ? '取消收藏' : '收藏到笔记'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                background: starred ? `${t.warn}1f` : 'transparent',
                border: starred ? `1px solid ${t.warn}55` : `1px solid ${t.line}`,
                fontSize: 11, fontWeight: 600,
                color: starred ? t.warn : t.textMute,
                transition: 'all .15s ease',
              }}
              onMouseEnter={e => { if (!starred) { e.currentTarget.style.borderColor = `${t.warn}66`; e.currentTarget.style.color = t.warn; } }}
              onMouseLeave={e => { if (!starred) { e.currentTarget.style.borderColor = t.line; e.currentTarget.style.color = t.textMute; } }}
            >
              <span style={{ fontSize: 12, lineHeight: 1 }}>{starred ? '⭐' : '☆'}</span>
              <span>{starred ? '已收藏' : '收藏到笔记'}</span>
            </div>
          </div>
        )}

        {/* 经验回答标识：KB 未命中时由 AI 基于行业经验作答 */}
        {msg.answerMode === 'experience' && !msg.fallbackReason && (
          <div style={{
            marginTop: 6, padding: '6px 10px', borderRadius: 10,
            background: `${t.accent}14`, border: `1px solid ${t.accent}44`,
            fontSize: 11, color: t.accent, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }} title="知识库未命中此问题，AI 基于产品特征与行业经验给出兜底回答，请以官方资料为准。">
            <Icon name="sparkle" size={11} color={t.accent} stroke={2.2} />
            <span>该内容由 AI 根据自己的经验回答</span>
          </div>
        )}

        {/* 经验模式下的「最接近的 KB 参考」：告知学员系统检索过、找到的最相关材料就这条
            视觉上故意弱化（灰系），避免学员误以为是答案出处 */}
        {msg.answerMode === 'experience' && msg.closestMatch && !msg.fallbackReason && (
          <div style={{
            marginTop: 6, padding: '8px 10px', borderRadius: 10,
            background: t.surface2 || 'transparent',
            border: `1px dashed ${t.line}`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: t.textMute, fontWeight: 600, marginBottom: 6,
            }}>
              <Icon name="book" size={11} color={t.textMute} stroke={2.2} />
              <span>知识库里最接近的材料</span>
              <span style={{
                marginLeft: 'auto',
                padding: '2px 8px', borderRadius: 999,
                background: t.surface, border: `1px solid ${t.line}`,
                fontSize: 10, color: t.textMute, fontWeight: 700,
              }} title="rerank 模型给出的相关度评分（>50% 通常强相关；20-50% 边缘；<20% 几乎无关）">
                相关度 {msg.closestMatch.score_percent}%
              </span>
            </div>
            <div
              title={`${msg.closestMatch.doc_name || ''}\n${msg.closestMatch.snippet || ''}`}
              onClick={() => setActiveCite(prev => prev === `closest-${msg.closestMatch.chunk_id}` ? null : `closest-${msg.closestMatch.chunk_id}`)}
              style={{
                padding: '6px 10px', borderRadius: 8,
                background: t.surface, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                border: `1px solid ${t.line}`,
                fontSize: 11, color: t.textSoft, fontWeight: 600,
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
              <Icon name="book" size={11} color={t.textMute} stroke={2.2} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {prettyDocName(msg.closestMatch.doc_name, '')}{(msg.closestMatch.slide_indices && msg.closestMatch.slide_indices.length)
                  ? ` · p${msg.closestMatch.slide_indices.join(',')}`
                  : ''}
              </span>
            </div>
            {activeCite === `closest-${msg.closestMatch.chunk_id}` && msg.closestMatch.snippet && (
              <div style={{
                marginTop: 6, padding: '6px 8px', borderRadius: 6,
                background: t.surface, border: `1px solid ${t.line}`,
                fontSize: 11, color: t.textSoft, lineHeight: 1.5,
              }}>
                {msg.closestMatch.snippet}
              </div>
            )}
            {msg.closestMatch.kps && msg.closestMatch.kps.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: t.textMute, fontWeight: 600, marginRight: 2 }}>可能相关</span>
                {msg.closestMatch.kps.map(k => (
                  <div key={k.kp_id} style={{
                    padding: '2px 7px', borderRadius: 999,
                    background: 'transparent',
                    fontSize: 10.5, color: t.textMute, fontWeight: 600,
                    border: `1px dashed ${t.line}`,
                  }}>
                    {k.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Verifier 降级提示：原答案被拒，正文已替换为安全提示文本 */}
        {msg.fallbackReason && (
          <div style={{
            marginTop: 6, padding: '6px 10px', borderRadius: 10,
            background: `${t.warn || '#c98a00'}18`, border: `1px solid ${t.warn || '#c98a00'}44`,
            fontSize: 11, color: t.warn || '#c98a00', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }} title={msg.rawAnswer ? `原回答被 Verifier 拒绝（${msg.fallbackReason}），已替换为提示文本` : msg.fallbackReason}>
            <Icon name="alert" size={11} color={t.warn || '#c98a00'} stroke={2.2} />
            <span>答案已降级（{msg.fallbackReason}）</span>
          </div>
        )}

        {/* RAG 来源（chunk 级，新链路） */}
        {msg.ragCitations && msg.ragCitations.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {msg.ragCitations.map((c) => (
              <div
                key={c.chunk_id}
                title={`${c.doc_name || ''}\n${c.snippet || ''}`}
                onClick={() => setActiveCite(prev => prev === c.index ? null : c.index)}
                style={{
                  padding: '6px 10px 6px 8px', borderRadius: 10,
                  background: t.surface2, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: activeCite === c.index
                    ? `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`
                    : `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
                  fontSize: 11, color: t.textSoft, fontWeight: 600,
                  maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 6, background: t.accent, color: '#fff', fontSize: 10,
                }}>{c.index}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prettyDocName(c.doc_name, c.index)}{(c.slide_indices && c.slide_indices.length)
                    ? ` · p${c.slide_indices.join(',')}`
                    : (c.slide_index ? ` · p${c.slide_index}` : '')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* tagged KP chips（新链路：后端打的 KP 标签）—— 视觉降级,让位给下方 followups */}
        {msg.taggedKps && msg.taggedKps.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: t.textMute, fontWeight: 600, marginRight: 2 }}>关联知识点</span>
            {msg.taggedKps.map(k => (
              <div key={k.kp_id} style={{
                padding: '2px 7px', borderRadius: 999,
                background: 'transparent',
                fontSize: 10.5, color: t.textMute, fontWeight: 600,
                border: `1px solid ${t.line}`,
              }}>
                {k.name}
              </div>
            ))}
          </div>
        )}

        {/* 引用（旧 KP_INDEX 链路，保留向后兼容） */}
        {msg.citations && msg.citations.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {msg.citations.map(id => {
              const ref = window.SIMUGO_DATA.KP_INDEX[id];
              if (!ref) return null;
              return (
                <div key={id} onClick={() => onCiteClick(id)} style={{
                  padding: '6px 10px 6px 8px', borderRadius: 999,
                  background: t.surface2, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
                  fontSize: 11.5, color: t.textSoft, fontWeight: 600,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: 999, background: t.accent }} />
                  <span>{ref.point.title}</span>
                  <Icon name="arrow" size={10} color={t.textMute} stroke={2} />
                </div>
              );
            })}
          </div>
        )}

        {/* 追问 */}
        {msg.followups && msg.followups.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', paddingLeft: 2 }}>
              猜你想问
            </div>
            {msg.followups.map((f, i) => (
              <div key={i} onClick={() => onFollowup(f)} style={{
                padding: '9px 12px', borderRadius: 14, cursor: 'pointer',
                background: 'transparent',
                border: `1px dashed ${t.line}`,
                fontSize: 12.5, color: t.textSoft,
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'all .15s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = t.surface2;
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.color = t.accent;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = t.line;
                  e.currentTarget.style.color = t.textSoft;
                }}
              >
                <Icon name="spark" size={11} color="currentColor" stroke={2} />
                <span style={{ flex: 1 }}>{f}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble({ t, stages, state, showStageTiming }) {
  const list = stages || [];
  const st = state || INITIAL_STAGE_STATE;
  // 当前正在执行的节点：currentIdx 指向"下一个待完成"的节点
  // 若已超出（synthesizer 也完成但 token 还没来），保持在最后一个 stage 的 running 文案
  const runningIdx = Math.min(st.currentIdx, list.length - 1);
  const runningLabel = list[runningIdx]?.running || '正在思考…';
  const doneItems = list.slice(0, st.currentIdx);
  const fmtDur = (ms) => {
    if (ms == null) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };
  // 学员视角默认隐藏耗时数字；研发开 TweaksPanel toggle 才显示
  const showTiming = !!showStageTiming;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 32, height: 32, borderRadius: 12, flexShrink: 0, marginTop: 2,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`,
        animation: 'aiqaPulse 1.4s ease-in-out infinite',
      }}>
        <Icon name="sparkle" size={16} color="#fff" stroke={2} />
      </div>
      <div style={{ ...neuFlat(t, 18), padding: '12px 14px', borderTopLeftRadius: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: t.text, fontWeight: 600 }}>{runningLabel}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: 999, background: t.textMute,
                animation: `aiqaDot 1.2s ease-in-out ${i * 0.18}s infinite`,
              }} />
            ))}
          </div>
        </div>
        {doneItems.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: t.textMute, letterSpacing: '0.02em', lineHeight: 1.5 }}>
            {doneItems.map((s, i) => (
              <span key={s.node}>
                {i > 0 && <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>}
                <span>{s.done}</span>
                {showTiming && (
                  <span style={{ marginLeft: 4, opacity: 0.7 }}>{fmtDur(st.durations[s.node])}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes aiqaDot { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
        @keyframes aiqaPulse { 0%, 100% { box-shadow: 2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}, 0 0 0 0 ${t.accent}55; } 50% { box-shadow: 2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}, 0 0 0 8px ${t.accent}00; } }
      `}</style>
    </div>
  );
}

// ─── 输入栏 ──────────────────────────────────────────────────
function Composer({ t, value, onChange, onSend, disabled }) {
  const inputRef = useRef(null);
  return (
    <div style={{ padding: '10px 14px 14px', background: `linear-gradient(180deg, ${t.bg}00 0%, ${t.bg} 30%)` }}>
      <div style={{
        ...neuInset(t, 26, 0.7),
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 6px 6px 18px',
      }}>
        <input
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="问点什么..."
          style={{
            flex: 1, border: 0, outline: 0, background: 'transparent',
            color: t.text, fontSize: 14.5, fontFamily: 'inherit',
            padding: '10px 0',
          }}
        />
        <button onClick={onSend} disabled={disabled || !value.trim()} style={{
          appearance: 'none', border: 0, cursor: (disabled || !value.trim()) ? 'not-allowed' : 'pointer',
          width: 38, height: 38, borderRadius: 999, flexShrink: 0,
          background: (disabled || !value.trim()) ? t.surface2 : t.accent,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: (disabled || !value.trim())
            ? `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`
            : `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.2)`,
          transition: 'all .15s ease',
        }}>
          <Icon name="arrow" size={16} color={(disabled || !value.trim()) ? t.textMute : '#fff'} stroke={2.2} />
        </button>
      </div>
    </div>
  );
}

// ─── KP 详情弹层 ──────────────────────────────────────────────
function KpDetailSheet({ t, kpId, onClose }) {
  const ref = window.SIMUGO_DATA.KP_INDEX[kpId];
  if (!ref) return null;
  const { module, point } = ref;
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 50, animation: 'aiqaFadeIn .2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxHeight: '78%',
        background: t.bg, borderRadius: '24px 24px 0 0',
        padding: '14px 22px 26px', overflow: 'auto',
        boxShadow: `0 -10px 30px rgba(0,0,0,0.25)`,
        animation: 'aiqaSlideUp .25s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: t.textMute, opacity: 0.5 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, background: t.surface2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, boxShadow: `2px 2px 4px ${t.sDark}, -2px -2px 4px ${t.sLight}`,
          }}>{module.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, letterSpacing: '0.05em' }}>{module.title}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginTop: 2 }}>{point.title}</div>
          </div>
        </div>
        <div style={{ fontSize: 13.5, color: t.textSoft, lineHeight: 1.65, marginBottom: 14 }}>
          {point.spec}
        </div>
        <div style={{
          padding: '12px 14px', borderRadius: 14,
          background: `linear-gradient(135deg, ${t.accent}12, ${t.accentSoft}12)`,
          borderLeft: `3px solid ${t.accent}`, marginBottom: 14,
        }}>
          <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 5 }}>销售应用提示</div>
          <div style={{ fontSize: 13, color: t.text, lineHeight: 1.6 }}>{point.sales}</div>
        </div>
        {point.customerVoice && (
          <div style={{ ...neuInset(t, 14, 0.6), padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>客户视角</div>
            <div style={{ fontSize: 13, color: t.text, fontStyle: 'italic', lineHeight: 1.55 }}>
              "{point.customerVoice}"
            </div>
          </div>
        )}
        <style>{`
          @keyframes aiqaFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes aiqaSlideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        `}</style>
      </div>
    </div>
  );
}

export { AIQAScreen };
