// screens-ai-qa.jsx — AI 答疑：员工学习阶段的产品私教
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";
import { QuizMode } from "./AIQuiz.jsx";

// ─── 系统提示词 ────────────────────────────────────────────────
function buildSystemPrompt(KNOWLEDGE) {
  // 把知识库压缩成紧凑 JSON 喂给模型
  const compact = KNOWLEDGE.map(m => ({
    id: m.id, title: m.title,
    points: m.points.map(p => ({
      id: p.id, title: p.title,
      spec: p.spec, sales: p.sales,
      customerVoice: p.customerVoice,
      rebuttals: (p.rebuttals || []).map(r => ({ q: r.q, a: r.approach })),
    })),
  }));
  return `你是极氪 007 销售训练平台的"产品私教"，对象是 4S 店销售顾问（学员）。
你的职责：用学员能听懂的话，帮他理解产品知识、想清楚客户对话怎么说。

【硬性边界】
- 只回答极氪 007 相关问题。如果学员问别的车型/品牌/通用知识，礼貌引导回 007。
- 所有事实必须来自下方知识库。不要编参数、不要瞎讲。
- 如果知识库没覆盖，明确说"这个我手里没有官方资料，建议查产品手册或问培训师"。

【回答风格】
- 像一个有耐心的资深同事，不是百科。短答案优先，不堆参数。
- 客户对话相关的问题，给"思路 + 一句示范话术"，不要长篇大论。
- 比较/对比类问题，先讲我们的事实，再讲差异，不要贬低竞品。

【输出格式 —— 严格 JSON，不要 markdown 代码块】
{
  "answer": "你的回答正文，60-180 字最佳，可以用换行分段",
  "citations": ["相关知识点 id 数组，例如 kp1-1。不相关不要硬塞"],
  "followups": ["2-3 条学员可能想接着问的短问题，每条 ≤ 16 字"]
}

【知识库】
${JSON.stringify(compact)}`;
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
// 入口 B：全局进入（无上下文）
const GLOBAL_STARTERS = [
  '客户刚从特斯拉店出来，怎么开场？',
  '北方客户问冬季续航怎么应对？',
  '一句话讲清 800V 的好处',
  '智驾对比 FSD 怎么讲不踩雷？',
];

// ─── 主屏 ──────────────────────────────────────────────────────
function AIQAScreen({ t, go, contextKpId, setContextKpId, initialMode }) {
  const { KP_INDEX } = window.SIMUGO_DATA;
  const contextKp = contextKpId ? KP_INDEX[contextKpId] : null;
  const [mode, setMode] = useState(initialMode || 'chat'); // 'chat' | 'quiz'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <TopBar t={t} title="AI 答疑 · 产品私教" onBack={() => go('home')} />
      <ModeSwitch t={t} mode={mode} onChange={setMode} />
      {mode === 'chat'
        ? <ChatMode key="chat" t={t} contextKp={contextKp} setContextKpId={setContextKpId} />
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
function ChatMode({ t, contextKp, setContextKpId }) {
  const { KNOWLEDGE, KP_INDEX } = window.SIMUGO_DATA;
  const SYSTEM_PROMPT = useMemo(() => buildSystemPrompt(KNOWLEDGE), [KNOWLEDGE]);

  const [messages, setMessages] = useState([]);    // {role:'user'|'ai', text, citations?, followups?}
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [openKpId, setOpenKpId] = useState(null);  // KP detail modal
  const scrollRef = useRef(null);
  const sessionIdRef = useRef(`n-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const starters = contextKp ? contextStarters(contextKp.point) : GLOBAL_STARTERS;

  const send = useCallback(async (text) => {
    const q = (text || '').trim();
    if (!q || thinking) return;
    setInput('');

    // 上下文注入：让模型知道学员当前在学什么
    let userPayload = q;
    if (contextKp && messages.length === 0) {
      userPayload = `[学员正在学习的知识点：${contextKp.module.title} · ${contextKp.point.title}（${contextKp.point.id}）]\n\n${q}`;
    }

    const next = [...messages, { role: 'user', text: q }];
    setMessages(next);
    setThinking(true);

    try {
      const apiMessages = [
        ...next.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.role === 'user' ? (m === next[next.length - 1] ? userPayload : m.text) : m.text,
        })),
      ];
      const raw = await window.claude.complete({
        system: SYSTEM_PROMPT,
        messages: apiMessages,
      });
      // 解析 JSON
      let parsed = null;
      try {
        const cleaned = raw.replace(/^```json\s*|```\s*$/g, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch (e) {
        parsed = { answer: raw, citations: [], followups: [] };
      }
      const validCites = (parsed.citations || []).filter(id => KP_INDEX[id]);
      const aiMsg = {
        role: 'ai',
        text: parsed.answer || '（这个问题我没想清楚，能换种说法吗？）',
        citations: validCites,
        followups: (parsed.followups || []).slice(0, 3),
      };
      const finalMessages = [...next, aiMsg];
      setMessages(finalMessages);
      // 持久化笔记
      if (window.SIMUGO_NOTES) {
        window.SIMUGO_NOTES.upsert({
          id: sessionIdRef.current, type: 'chat',
          contextKpId: contextKp ? contextKp.point.id : null,
          messages: finalMessages,
        });
        window.notifyNotesChanged && window.notifyNotesChanged();
      }
    } catch (e) {
      setMessages(m => [...m, {
        role: 'ai',
        text: '网络不太顺，再试一次？',
        citations: [], followups: [],
      }]);
    } finally {
      setThinking(false);
    }
  }, [messages, thinking, contextKp, SYSTEM_PROMPT, KP_INDEX]);

  const clearContext = () => setContextKpId(null);
  const resetChat = () => {
    setMessages([]);
    sessionIdRef.current = `n-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  };

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
            {messages.map((m, i) => (
              <Bubble key={i} t={t} msg={m}
                onCiteClick={(id) => setOpenKpId(id)}
                onFollowup={send} />
            ))}
            {thinking && <ThinkingBubble t={t} />}
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
    </div>
  );
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
          : '只懂极氪 007——参数、应答思路、对比话术，挑你想清楚的问。'}
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
function Bubble({ t, msg, onCiteClick, onFollowup }) {
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
        }}>{msg.text}</div>

        {/* 引用 */}
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
              还想问
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

function ThinkingBubble({ t }) {
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
      <div style={{ ...neuFlat(t, 18), padding: '14px 16px', borderTopLeftRadius: 6 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: 999, background: t.textMute,
              animation: `aiqaDot 1.2s ease-in-out ${i * 0.18}s infinite`,
            }} />
          ))}
        </div>
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
