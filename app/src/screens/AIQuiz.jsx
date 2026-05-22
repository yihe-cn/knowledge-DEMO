// screens-ai-quiz.jsx — "AI 考我" 模式：AI 扮客户突击，给评分 + 参考答案
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";

const QUIZ_COUNT = 5;

// ─── 出题 prompt ──────────────────────────────────────────────
function buildQuestionPrompt(KNOWLEDGE, customer, contextKp, count) {
  // 只用学员可能学过的 KP（context 优先 → 全量）
  const scope = contextKp ? [{
    id: contextKp.module.id, title: contextKp.module.title,
    points: [contextKp.point],
  }] : KNOWLEDGE;
  const compact = scope.map(m => ({
    id: m.id, title: m.title,
    points: m.points.map(p => ({
      id: p.id, title: p.title,
      spec: p.spec,
      rebuttalSeeds: (p.rebuttals || []).map(r => r.q),
    })),
  }));
  return `你是销售训练教练。请基于知识库和客户人设，生成 ${count} 个客户会真的问出口的提问，用来突击考员工。

【客户人设】
${customer.name}，${customer.age}岁，${customer.job}，${customer.tagline}。
背景：${customer.context}。
个性：${(customer.personality || []).join('、')}。
关心的问题：${(customer.concerns || []).map(c => c.tag).join('、')}。

【题型要求】
- 覆盖至少 3 种类型：参数类（问数据）、异议类（带顾虑/质疑）、对比类（提竞品）、应用类（问怎么用）
- 每题来自不同 KP，不要扎堆
- 必须完全贴合人设口吝：${customer.name}怎么说话，题干就怎么写。不是面试题。
- 一句话，不超过 35 字

【知识范围】
${JSON.stringify(compact)}

【输出 —— 严格 JSON】
{
  "questions": [
    {"id": "q1", "text": "客户问题文本", "type": "参数|异议|对比|应用", "primaryKpId": "kpX-Y", "tone": "neutral|concern|challenge|interested"}
  ]
}`;
}

// ─── 评分 prompt ──────────────────────────────────────────────
function buildGradePrompt(question, kp, studentAnswer) {
  return `你是销售训练教练。学员正在做"客户突击"训练，请评估这个回答。

【客户问题】"${question.text}"（${question.type}类）

【关联知识点 · ${kp.point.title}】
参数事实：${kp.point.spec}
销售应用思路：${kp.point.sales}
${kp.point.customerVoice ? `客户视角金句：${kp.point.customerVoice}` : ''}
${(kp.point.rebuttals || []).map(r => `参考异议处理：${r.q} → ${r.approach}`).join('\n')}

【学员答案】"${studentAnswer}"

【评估维度】
- 有没有抓到核心信息点
- 有没有具体数据/场景化（而不是空话）
- 有没有共情客户真实顾虑
- 有没有套话/贬低竞品

【输出 —— 严格 JSON】
{
  "rating": "good" | "mid" | "bad",
  "comment": "1-2 句话评语，针对学员实际答的内容，不要套话",
  "missing": "可选：缺什么 或 加分项",
  "referenceAnswer": "标杆答案（参考 SCRIPT 里 quality:good 的话术风格，40-100 字，可以换行）",
  "citations": ["相关 kp id 数组"]
}`;
}

// ─── 标杆答案 fallback：如果模型挂了，用 SCRIPT 里现成的好答案兜底
function fallbackReference(kpId, KNOWLEDGE) {
  return '这个问题建议参考课程里"销售应用提示"部分，用具体数据+场景化的方式回应。';
}

// ─── Quiz 主组件 ──────────────────────────────────────────────
function QuizMode({ t, contextKp, setContextKpId }) {
  const { KNOWLEDGE, KP_INDEX, CUSTOMERS } = window.SIMUGO_DATA;

  // 客户人设选择（默认郑先生）
  const [customerId, setCustomerId] = useState(CUSTOMERS[0].id);
  const customer = CUSTOMERS.find(c => c.id === customerId) || CUSTOMERS[0];

  // phase: intro → generating → quiz(asking|grading|graded) → summary
  const [phase, setPhase] = useState('intro');
  const [questions, setQuestions] = useState([]);     // 5 generated questions
  const [idx, setIdx] = useState(0);                   // current question index
  const [studentInput, setStudentInput] = useState('');
  const [submitted, setSubmitted] = useState([]);     // [{question, studentAnswer, grade}]
  const [currentGrade, setCurrentGrade] = useState(null); // grade for current question (while displayed)
  const [grading, setGrading] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [showOptions, setShowOptions] = useState(false); // "看选项" 兜底
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [phase, idx, currentGrade, grading]);

  // ─── 启动：生成 5 题 ──
  const startQuiz = useCallback(async () => {
    setPhase('generating');
    try {
      const prompt = buildQuestionPrompt(KNOWLEDGE, customer, contextKp, QUIZ_COUNT);
      const raw = await window.claude.complete({
        system: prompt,
        messages: [{ role: 'user', content: `请基于 ${customer.name} 的人设和顾虑，生成 ${QUIZ_COUNT} 个突击题。` }],
      });
      const parsed = parseJSON(raw);
      let qs = (parsed && parsed.questions) || [];
      qs = qs.filter(q => q.text && KP_INDEX[q.primaryKpId]).slice(0, QUIZ_COUNT);
      if (qs.length === 0) throw new Error('no questions');
      setQuestions(qs);
      setIdx(0);
      setPhase('quiz');
    } catch (e) {
      // 兜底：从 KNOWLEDGE rebuttals 里抓
      const fb = collectFallbackQuestions(KNOWLEDGE, contextKp, QUIZ_COUNT);
      setQuestions(fb);
      setIdx(0);
      setPhase('quiz');
    }
  }, [KNOWLEDGE, customer, KP_INDEX, contextKp]);

  // ─── 提交回答 ──
  const submitAnswer = useCallback(async (answer) => {
    const text = (answer || '').trim();
    if (!text || grading) return;
    const q = questions[idx];
    const kp = KP_INDEX[q.primaryKpId];
    setGrading(true);
    setStudentInput('');
    try {
      const prompt = buildGradePrompt(q, kp, text);
      const raw = await window.claude.complete({
        system: prompt,
        messages: [{ role: 'user', content: '请评分。' }],
      });
      const grade = parseJSON(raw) || {};
      const safe = {
        rating: ['good', 'mid', 'bad'].includes(grade.rating) ? grade.rating : 'mid',
        comment: grade.comment || '',
        missing: grade.missing || '',
        referenceAnswer: grade.referenceAnswer || fallbackReference(q.primaryKpId, KNOWLEDGE),
        citations: (grade.citations || []).filter(id => KP_INDEX[id]),
        studentAnswer: text,
      };
      setCurrentGrade(safe);
    } catch (e) {
      setCurrentGrade({
        rating: 'mid', comment: '网络不太顺，没能拿到 AI 教练的反馈。',
        referenceAnswer: fallbackReference(q.primaryKpId, KNOWLEDGE),
        citations: [q.primaryKpId], studentAnswer: text,
      });
    } finally {
      setGrading(false);
    }
  }, [questions, idx, grading, KP_INDEX, KNOWLEDGE]);

  // ─── 下一题 / 收尾 ──
  const nextQuestion = useCallback(() => {
    const q = questions[idx];
    setSubmitted(s => [...s, { question: q, ...currentGrade }]);
    setCurrentGrade(null);
    setShowRef(false);
    setShowOptions(false);
    if (idx + 1 >= questions.length) {
      setPhase('summary');
    } else {
      setIdx(idx + 1);
    }
  }, [questions, idx, currentGrade]);

  // ─── 提前结束 ──
  const stopEarly = useCallback(() => {
    if (currentGrade) {
      setSubmitted(s => [...s, { question: questions[idx], ...currentGrade }]);
    }
    setPhase('summary');
  }, [currentGrade, questions, idx]);

  // ─── 重新开始 ──
  const restart = () => {
    setQuestions([]); setIdx(0); setSubmitted([]); setCurrentGrade(null);
    setShowRef(false); setShowOptions(false); setPhase('intro');
  };

  // ─── 进入 summary 时自动保存笔记 ──
  const noteSavedRef = useRef(null);
  useEffect(() => {
    if (phase !== 'summary' || !window.SIMUGO_NOTES) return;
    if (submitted.length === 0) return;
    // 每个 summary 只保存一次（用第一次进入 summary 时的 submitted 数组哈希做指纹）
    const fingerprint = `${submitted.length}-${submitted.map(s => s.rating).join('')}`;
    if (noteSavedRef.current === fingerprint) return;
    noteSavedRef.current = fingerprint;

    const counts = { good: 0, mid: 0, bad: 0 };
    submitted.forEach(s => { if (counts[s.rating] !== undefined) counts[s.rating]++; });
    const score = Math.round((counts.good * 100 + counts.mid * 60) / Math.max(submitted.length, 1));

    window.SIMUGO_NOTES.add({
      type: 'quiz',
      customerId: customer.id,
      contextKpId: contextKp ? contextKp.point.id : null,
      results: submitted,
      score,
    });
    window.notifyNotesChanged && window.notifyNotesChanged();
  }, [phase, submitted, customer, contextKp]);

  // ═══ 渲染 ═══
  if (phase === 'intro') {
    return <QuizIntro t={t} contextKp={contextKp} onStart={startQuiz} count={QUIZ_COUNT}
      setContextKpId={setContextKpId} customer={customer} customers={CUSTOMERS}
      onPickCustomer={setCustomerId} />;
  }
  if (phase === 'generating') {
    return <QuizGenerating t={t} customer={customer} />;
  }
  if (phase === 'summary') {
    return <QuizSummary t={t} submitted={submitted} onRestart={restart} contextKp={contextKp} customer={customer} />;
  }

  // ─── quiz phase ───
  const q = questions[idx];
  const kp = KP_INDEX[q.primaryKpId];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Progress strip */}
      <QuizProgress t={t} idx={idx} total={questions.length} submitted={submitted} onStop={stopEarly} />

      {/* Conversation area */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '12px 18px 8px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* Customer asks */}
        <CustomerBubble t={t} question={q} customer={customer} />

        {/* Student's answer (if submitted, before grade resolved or after) */}
        {currentGrade && (
          <StudentAnswerBubble t={t} text={currentGrade.studentAnswer} />
        )}

        {/* Grading or grade */}
        {grading && <CoachThinking t={t} />}
        {currentGrade && (
          <CoachGradeBubble
            t={t} grade={currentGrade} kp={kp}
            showRef={showRef} onToggleRef={() => setShowRef(s => !s)}
          />
        )}
      </div>

      {/* Footer: input OR continue button */}
      <QuizFooter
        t={t}
        graded={!!currentGrade}
        grading={grading}
        showOptions={showOptions}
        question={q}
        kp={kp}
        input={studentInput}
        onInput={setStudentInput}
        onSubmit={() => submitAnswer(studentInput)}
        onPickOption={(text) => submitAnswer(text)}
        onShowOptions={() => setShowOptions(true)}
        onNext={nextQuestion}
        isLast={idx === questions.length - 1}
      />
    </div>
  );
}

// ─── 起手页 ──────────────────────────────────────────────────
function QuizIntro({ t, contextKp, onStart, count, setContextKpId, customer, customers, onPickCustomer }) {
  // 头像配色
  const avatarStyle = customerAvatarStyle(t, customer);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 20px', display: 'flex', flexDirection: 'column' }}>
      {/* 上下文芯片（可清除） */}
      {contextKp && (
        <div style={{ marginBottom: 14 }}>
          <ContextChip t={t} contextKp={contextKp} onClear={() => setContextKpId(null)} />
        </div>
      )}

      <div style={{
        ...neuRaised(t, 22, 1.1), padding: '20px 18px',
        background: `linear-gradient(135deg, ${t.surface} 0%, ${t.surface2} 100%)`,
        position: 'relative', overflow: 'hidden', marginBottom: 14,
      }}>
        <div style={{
          position: 'absolute', right: -30, top: -30, width: 140, height: 140,
          borderRadius: '50%', background: `radial-gradient(circle, ${avatarStyle.glow} 0%, transparent 70%)`,
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 50, height: 50, borderRadius: 16,
              background: avatarStyle.bg, color: avatarStyle.fg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 700,
              boxShadow: `3px 3px 7px ${t.sDark}, -2px -2px 5px ${t.sLight}`,
            }}>{customer.avatar}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, letterSpacing: '0.08em' }}>
                今日突击客户 · {customer.emoji} {customer.vibe}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginTop: 1 }}>
                {customer.name} <span style={{ fontSize: 12, fontWeight: 500, color: t.textMute, marginLeft: 4 }}>{customer.age}岁 · {customer.job}</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: t.textSoft, lineHeight: 1.6, marginBottom: 10 }}>
            {customer.tagline} · {customer.budget}<br/>
            {customer.context}
          </div>

          {/* 关键顾虑预览 */}
          {customer.concerns && customer.concerns.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
              {customer.concerns.slice(0, 4).map((c, i) => (
                <div key={i} style={{
                  fontSize: 10.5, padding: '3px 8px', borderRadius: 999,
                  background: `${t.accent}14`, color: t.accent, fontWeight: 600,
                }}>{c.tag}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 切换人设 */}
      <CustomerSwitcher t={t} customers={customers} currentId={customer.id} onPick={onPickCustomer} />

      <div style={{ ...neuInset(t, 16, 0.6), padding: '14px 16px', margin: '14px 0 16px' }}>
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>规则</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { n: '①', t: `${customer.name}会连问 ${count} 个问题${contextKp ? '，全部围绕你刚学的这个知识点' : '，覆盖不同类型'}` },
            { n: '②', t: '你用一句话回应（不会的话可以"看选项"兜底）' },
            { n: '③', t: '每题答完，AI 教练立刻给你评分 + 参考答案' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: t.textSoft, lineHeight: 1.55 }}>
              <span style={{ color: t.accent, fontWeight: 700, fontSize: 13 }}>{r.n}</span>
              <span style={{ flex: 1 }}>{r.t}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <PillButton t={t} primary onClick={onStart} style={{ width: '100%', padding: '16px', fontSize: 15 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="bolt" size={16} color="#fff" stroke={2.2} />
          让 {customer.name} 开始突击 · {count} 题
        </span>
      </PillButton>
    </div>
  );
}

// ─── 客户切换器（三张迷你卡） ──
function CustomerSwitcher({ t, customers, currentId, onPick }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8, paddingLeft: 4 }}>
        换个客户练
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {customers.map(c => {
          const active = c.id === currentId;
          const style = customerAvatarStyle(t, c);
          return (
            <div key={c.id} onClick={() => onPick(c.id)} style={{
              flex: 1, padding: '10px 8px 9px', borderRadius: 14,
              cursor: 'pointer', textAlign: 'center',
              background: active ? `linear-gradient(135deg, ${style.glow}, ${t.surface})` : t.surface,
              boxShadow: active
                ? `3px 3px 7px ${t.sDark}, -2px -2px 5px ${t.sLight}, inset 0 0 0 1.5px ${t.accent}`
                : `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`,
              transition: 'all .2s ease',
            }}>
              <div style={{ fontSize: 20, marginBottom: 3 }}>{c.emoji}</div>
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
    </div>
  );
}

// 客户头像配色 —— 三种区分
function customerAvatarStyle(t, customer) {
  const map = {
    dark: { bg: t.text, fg: t.bg, glow: `${t.accent}15` },
    warm: { bg: `linear-gradient(135deg, ${t.warn}, ${t.accentSoft})`, fg: '#fff', glow: `${t.warn}18` },
    gold: { bg: `linear-gradient(135deg, #C9A961, #8B6F2F)`, fg: '#fff', glow: '#C9A96118' },
  };
  return map[customer.avatarColor] || map.dark;
}

// ─── 生成中 ──
function QuizGenerating({ t, customer }) {
  const style = customerAvatarStyle(t, customer);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
      <div style={{
        width: 60, height: 60, borderRadius: 20,
        background: style.bg, color: style.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, fontWeight: 700,
        boxShadow: `4px 4px 10px ${t.sDark}, -3px -3px 8px ${t.sLight}`,
        marginBottom: 18,
        animation: 'quizPulse 1.4s ease-in-out infinite',
      }}>{customer.avatar}</div>
      <div style={{ fontSize: 15, color: t.text, fontWeight: 600, marginBottom: 6 }}>{customer.name}正在想问题…</div>
      <div style={{ fontSize: 12.5, color: t.textSoft }}>给你准备 5 道客户级提问</div>
      <style>{`
        @keyframes quizPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
      `}</style>
    </div>
  );
}

// ─── 顶部进度 ──
function QuizProgress({ t, idx, total, submitted, onStop }) {
  return (
    <div style={{ padding: '4px 18px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: t.textMute, fontWeight: 700, letterSpacing: '0.06em' }}>
          第 <span style={{ color: t.accent, fontSize: 15 }}>{idx + 1}</span> / {total} 题
        </div>
        <div style={{ flex: 1 }} />
        <div onClick={onStop} style={{
          ...neuFlat(t, 999), padding: '5px 11px', cursor: 'pointer',
          fontSize: 11, color: t.textSoft, fontWeight: 600,
        }}>答够了</div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => {
          const past = submitted[i];
          const isCurrent = i === idx;
          let bg = t.surface2, sh = `inset 1px 1px 2px ${t.sDark}, inset -1px -1px 2px ${t.sLight}`;
          if (past) {
            bg = past.rating === 'good' ? t.good : past.rating === 'mid' ? t.warn : t.bad;
            sh = `0 1px 3px ${t.sDark}`;
          } else if (isCurrent) {
            bg = `linear-gradient(90deg, ${t.accent}, ${t.accentSoft})`;
            sh = `0 1px 4px ${t.sDark}`;
          }
          return (
            <div key={i} style={{
              flex: 1, height: 5, borderRadius: 999,
              background: bg, boxShadow: sh,
              transition: 'all .3s ease',
            }} />
          );
        })}
      </div>
    </div>
  );
}

// ─── 上下文芯片（与 chat 模式共用风格） ──
function ContextChip({ t, contextKp, onClear }) {
  return (
    <div style={{
      ...neuFlat(t, 999), padding: '8px 8px 8px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: `linear-gradient(135deg, ${t.accent}18, ${t.accentSoft}10)`,
    }}>
      <div style={{ width: 6, height: 6, borderRadius: 999, background: t.accent, boxShadow: `0 0 0 4px ${t.accent}22` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.1em' }}>突击主题</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginTop: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {contextKp.module.icon} {contextKp.point.title}
        </div>
      </div>
      <div onClick={onClear} style={{
        width: 26, height: 26, borderRadius: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', background: t.surface2,
        boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
      }}>
        <Icon name="close" size={12} color={t.textSoft} stroke={2.2} />
      </div>
    </div>
  );
}

// ─── 客户气泡（左边、灰底，配头像和题型标签） ──
function CustomerBubble({ t, question, customer }) {
  const style = customerAvatarStyle(t, customer);
  const typeColors = {
    '参数': t.accent, '异议': t.bad, '对比': t.warn, '应用': t.good,
  };
  const tc = typeColors[question.type] || t.accent;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: '92%' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 13, flexShrink: 0, marginTop: 2,
        background: style.bg, color: style.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700,
        boxShadow: `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`,
      }}>{customer.avatar}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, paddingLeft: 2 }}>
          <span style={{ fontSize: 11, color: t.textMute, fontWeight: 600 }}>{customer.name}</span>
          <span style={{
            padding: '1px 7px', borderRadius: 6, fontSize: 9.5, fontWeight: 700,
            background: `${tc}1f`, color: tc, letterSpacing: '0.05em',
          }}>{question.type}</span>
        </div>
        <div style={{
          ...neuFlat(t, 18), padding: '12px 14px',
          fontSize: 15, color: t.text, lineHeight: 1.55,
          borderTopLeftRadius: 6,
        }}>{question.text}</div>
      </div>
    </div>
  );
}

// ─── 学员回答气泡 ──
function StudentAnswerBubble({ t, text }) {
  return (
    <div style={{ alignSelf: 'flex-end', maxWidth: '82%' }}>
      <div style={{
        padding: '11px 15px', borderRadius: '22px 22px 6px 22px',
        background: t.accent, color: '#fff',
        fontSize: 14, lineHeight: 1.55,
        boxShadow: `3px 3px 8px ${t.sDark}, -2px -2px 6px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)`,
        whiteSpace: 'pre-wrap',
      }}>{text}</div>
    </div>
  );
}

// ─── 教练评分（带可展开参考答案） ──
function CoachGradeBubble({ t, grade, kp, showRef, onToggleRef }) {
  const ratings = {
    good: { label: '不错', icon: '✅', color: t.good, accent: '抓到了关键点' },
    mid:  { label: '可以更好', icon: '⚠️', color: t.warn, accent: '差一点意思' },
    bad:  { label: '这样客户会冷场', icon: '❌', color: t.bad, accent: '建议换个思路' },
  };
  const r = ratings[grade.rating];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 13, flexShrink: 0, marginTop: 2,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`,
      }}>
        <Icon name="sparkle" size={17} color="#fff" stroke={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, marginBottom: 4, paddingLeft: 2 }}>AI 教练</div>

        {/* 评级条 */}
        <div style={{
          padding: '12px 14px', borderRadius: '18px 18px 18px 18px',
          background: `${r.color}15`,
          border: `1.5px solid ${r.color}40`,
          marginBottom: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>{r.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: r.color }}>{r.label}</span>
            <span style={{ fontSize: 11, color: t.textMute }}>· {r.accent}</span>
          </div>
          <div style={{ fontSize: 13, color: t.text, lineHeight: 1.6 }}>{grade.comment}</div>
          {grade.missing && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: t.surface, fontSize: 12, color: t.textSoft, lineHeight: 1.5 }}>
              <span style={{ color: r.color, fontWeight: 700 }}>提示 · </span>{grade.missing}
            </div>
          )}
        </div>

        {/* 参考答案折叠 */}
        <div style={{
          ...neuFlat(t, 14), overflow: 'hidden',
        }}>
          <div onClick={onToggleRef} style={{
            padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          }}>
            <Icon name="target" size={14} color={t.accent} stroke={2} />
            <span style={{ flex: 1, fontSize: 12.5, color: t.text, fontWeight: 600 }}>参考答案</span>
            <div style={{ transform: `rotate(${showRef ? 90 : 0}deg)`, transition: 'transform .2s' }}>
              <Icon name="arrow" size={12} color={t.textMute} />
            </div>
          </div>
          {showRef && (
            <div style={{
              padding: '0 14px 14px', fontSize: 13, color: t.textSoft, lineHeight: 1.7,
              whiteSpace: 'pre-wrap', borderTop: `1px solid ${t.line}`, paddingTop: 12, marginTop: -1,
            }}>
              {grade.referenceAnswer}
              {kp && (
                <div style={{ marginTop: 10, fontSize: 11, color: t.textMute }}>
                  📖 关联：{kp.module.title} · {kp.point.title}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 教练评估中 ──
function CoachThinking({ t }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 13, flexShrink: 0,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`,
      }}>
        <Icon name="sparkle" size={17} color="#fff" stroke={2} />
      </div>
      <div style={{ ...neuFlat(t, 18), padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: 999, background: t.textMute,
              animation: `quizDot 1.2s ease-in-out ${i * 0.18}s infinite`,
            }} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes quizDot { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
      `}</style>
    </div>
  );
}

// ─── 底部：输入/选项/下一题 ──
function QuizFooter({ t, graded, grading, showOptions, question, kp, input, onInput, onSubmit, onPickOption, onShowOptions, onNext, isLast }) {
  // 评分完成 → 显示"下一题"
  if (graded) {
    return (
      <div style={{ padding: '12px 14px 14px', background: `linear-gradient(180deg, ${t.bg}00 0%, ${t.bg} 30%)` }}>
        <PillButton t={t} primary onClick={onNext} style={{ width: '100%' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {isLast ? '完成突击 →' : '下一题 →'}
          </span>
        </PillButton>
      </div>
    );
  }
  // 答题中 → 选项兜底面板
  if (showOptions) {
    const options = buildAnswerOptions(question, kp);
    return (
      <div style={{ padding: '8px 18px 14px', background: `linear-gradient(180deg, ${t.bg}00 0%, ${t.bg} 30%)` }}>
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8, paddingLeft: 2 }}>
          选一个最接近的答案 · AI 会评价你的选择
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt, i) => (
            <div key={i} onClick={() => onPickOption(opt.text)} style={{
              ...neuFlat(t, 14), padding: '11px 14px', cursor: 'pointer',
              fontSize: 13, color: t.text, lineHeight: 1.5,
            }}>{opt.text}</div>
          ))}
        </div>
      </div>
    );
  }
  // 答题中 → 输入框 + 看选项
  return (
    <div style={{ padding: '10px 14px 14px', background: `linear-gradient(180deg, ${t.bg}00 0%, ${t.bg} 30%)` }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <div onClick={onShowOptions} style={{
          padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
          fontSize: 11, color: t.textMute, fontWeight: 600,
          border: `1px dashed ${t.line}`,
        }}>不会，看选项</div>
      </div>
      <div style={{
        ...neuInset(t, 26, 0.7),
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 6px 6px 18px',
      }}>
        <input
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
          placeholder="你会怎么回客户？"
          disabled={grading}
          style={{
            flex: 1, border: 0, outline: 0, background: 'transparent',
            color: t.text, fontSize: 14.5, fontFamily: 'inherit',
            padding: '10px 0',
          }}
        />
        <button onClick={onSubmit} disabled={grading || !input.trim()} style={{
          appearance: 'none', border: 0, cursor: (grading || !input.trim()) ? 'not-allowed' : 'pointer',
          width: 38, height: 38, borderRadius: 999, flexShrink: 0,
          background: (grading || !input.trim()) ? t.surface2 : t.accent,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: (grading || !input.trim())
            ? `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`
            : `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.2)`,
        }}>
          <Icon name="arrow" size={16} color={(grading || !input.trim()) ? t.textMute : '#fff'} stroke={2.2} />
        </button>
      </div>
    </div>
  );
}

// ─── 小结 ────────────────────────────────────────────────────
function QuizSummary({ t, submitted, onRestart, contextKp, customer }) {
  const counts = { good: 0, mid: 0, bad: 0 };
  submitted.forEach(s => { if (counts[s.rating] !== undefined) counts[s.rating]++; });
  const total = submitted.length;
  const score = Math.round((counts.good * 100 + counts.mid * 60) / Math.max(total, 1));

  // 薄弱知识点统计
  const kpWeak = {};
  submitted.forEach(s => {
    if (s.rating === 'bad' || s.rating === 'mid') {
      const kpId = s.question.primaryKpId;
      kpWeak[kpId] = (kpWeak[kpId] || 0) + 1;
    }
  });
  const weakList = Object.entries(kpWeak).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const tone = score >= 85 ? { label: '稳了', color: t.good, icon: '🎯' }
    : score >= 60 ? { label: '基础在，细节再练', color: t.warn, icon: '💪' }
    : { label: '回炉重学', color: t.bad, icon: '📚' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 20px' }}>
      <div style={{
        ...neuRaised(t, 24, 1.2),
        padding: '24px 20px', textAlign: 'center', marginBottom: 16,
        background: `linear-gradient(135deg, ${tone.color}10 0%, ${t.surface} 70%)`,
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>{tone.icon}</div>
        <div style={{ fontSize: 12, color: t.textMute, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 6 }}>突击结束</div>
        <div style={{ fontSize: 44, fontWeight: 800, color: tone.color, lineHeight: 1, marginBottom: 4 }}>
          {score}<span style={{ fontSize: 18, color: t.textMute, fontWeight: 600 }}> 分</span>
        </div>
        <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>{tone.label}</div>
      </div>

      {/* 分布 */}
      <div style={{ ...neuFlat(t, 18), padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 12 }}>答题分布</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { k: 'good', label: '不错', c: t.good, n: counts.good },
            { k: 'mid', label: '可以更好', c: t.warn, n: counts.mid },
            { k: 'bad', label: '冷场', c: t.bad, n: counts.bad },
          ].map(item => (
            <div key={item.k} style={{
              flex: 1, padding: '12px 8px', borderRadius: 12,
              background: `${item.c}12`,
              border: `1px solid ${item.c}30`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: item.c }}>{item.n}</div>
              <div style={{ fontSize: 10.5, color: t.textSoft, marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 薄弱知识点 */}
      {weakList.length > 0 && (
        <div style={{ ...neuFlat(t, 18), padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: t.textMute, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 10 }}>
            建议复习
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {weakList.map(([id, n]) => {
              const ref = window.SIMUGO_DATA.KP_INDEX[id];
              if (!ref) return null;
              return (
                <div key={id} style={{
                  padding: '10px 12px', borderRadius: 12,
                  background: t.surface2,
                  display: 'flex', alignItems: 'center', gap: 10,
                  boxShadow: `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
                }}>
                  <div style={{ fontSize: 16 }}>{ref.module.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{ref.point.title}</div>
                    <div style={{ fontSize: 11, color: t.textMute, marginTop: 1 }}>{ref.module.title}</div>
                  </div>
                  <div style={{ fontSize: 10, color: t.bad, fontWeight: 700,
                    padding: '3px 7px', borderRadius: 999, background: `${t.bad}15` }}>
                    {n} 题失分
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 重答 */}
      <PillButton t={t} primary onClick={onRestart} style={{ width: '100%' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="refresh" size={14} color="#fff" stroke={2.2} />
          再来一组
        </span>
      </PillButton>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────
function parseJSON(raw) {
  if (!raw) return null;
  try {
    const cleaned = String(raw).replace(/^```json\s*|```\s*$/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) { return null; }
}

function collectFallbackQuestions(KNOWLEDGE, contextKp, count) {
  // 用 rebuttals 里的 q 作为兜底题
  const pool = [];
  const points = contextKp ? [contextKp.point] : KNOWLEDGE.flatMap(m => m.points);
  points.forEach(p => {
    (p.rebuttals || []).forEach((r, i) => {
      pool.push({
        id: `${p.id}-fb${i}`, text: r.q, type: '异议', primaryKpId: p.id, tone: 'concern',
      });
    });
  });
  // 洗牌取 count
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function buildAnswerOptions(question, kp) {
  // 选项兜底：模拟好/中/差三档
  if (!kp) return [{ text: '抱歉，没有合适的选项可参考。' }];
  return [
    { quality: 'good', text: `${kp.point.sales.replace(/。$/, '')}。比如：${kp.point.customerVoice || ''}` },
    { quality: 'mid',  text: kp.point.spec.slice(0, 60) + (kp.point.spec.length > 60 ? '…' : '') },
    { quality: 'bad',  text: '这个您放心，我们做的很专业的。' },
  ];
}

export { QuizMode };
