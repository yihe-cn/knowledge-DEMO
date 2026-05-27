// 考核任务学员端。两种进入方式：
//   1. URL ?token=xxx  → AppRoot 直接渲染（外发分享链接）
//   2. AccountHome / HomeScreen 内 go('assessment',{token})  → 由 props 传入
// 主题完全跟随 t.*；视觉对齐 HomeScreen / Practice。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { neuRaised, neuInset, useTheme } from '../theme.js';
import { Icon } from '../components/Primitives.jsx';
import {
  getSessionInfo,
  oralAnswer,
  oralNext,
  setAssessmentToken,
  submitAssignment,
  submitBankAnswer,
} from '../lib/assessmentClient.js';

const STATUS_LABEL = {
  pending: '待开始',
  in_progress: '进行中',
  submitted: '已提交',
  graded: '已完成',
  stopped: '已停止',
};

/**
 * @param {object} props
 * @param {object} [props.t] —— 主题；外发链接场景未传，会用默认 'cream'
 * @param {string} [props.token] —— 主流程进入时由 go() 注入；外发场景从 URL 自动读取
 * @param {() => void} [props.onBack] —— 主流程提供；外发链接不显示返回按钮
 */
export function AssessmentScreen({ t: tProp, token: tokenProp, onBack }) {
  // 外发链接没有 t，给个默认主题；主流程从 App 传 t
  const tDefault = useTheme('cream');
  const t = tProp || tDefault;

  // 主流程进入：把 token 注入到 client（unmount 清空，避免污染外发场景）
  useEffect(() => {
    if (tokenProp) {
      setAssessmentToken(tokenProp);
      return () => setAssessmentToken(null);
    }
  }, [tokenProp]);

  const [session, setSession] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [finalReport, setFinalReport] = useState(null);

  useEffect(() => {
    getSessionInfo()
      .then(setSession)
      .catch((e) => setLoadErr(e.message || String(e)));
  }, [tokenProp]);

  const locked = session
    ? session.assignment.status === 'submitted' || session.assignment.status === 'graded'
    : false;
  const stopped = session?.assignment?.status === 'stopped';

  useEffect(() => {
    if (!locked || finalReport) return;
    let alive = true;
    submitAssignment().then((r) => {
      if (alive) setFinalReport(r);
    }).catch(() => {});
    return () => { alive = false; };
  }, [locked, finalReport]);

  if (loadErr) {
    return (
      <Shell t={t} onBack={onBack}>
        <div style={{ ...neuRaised(t, 18), padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.text, marginBottom: 8 }}>无法打开考核</div>
          <div style={{ color: t.textSoft, marginBottom: 4 }}>{loadErr}</div>
          <div style={{ color: t.textMute, fontSize: 12 }}>链接可能已失效或被催办重置，请联系发起人。</div>
        </div>
      </Shell>
    );
  }
  if (!session) {
    return (
      <Shell t={t} onBack={onBack}>
        <div style={{ color: t.textMute, textAlign: 'center', padding: 32 }}>正在载入考核…</div>
      </Shell>
    );
  }

  const { template, assignment, answered } = session;

  if (finalReport) {
    return (
      <Shell t={t} onBack={onBack}>
        <FinalReport t={t} report={finalReport} template={template} onBack={onBack} />
      </Shell>
    );
  }

  return (
    <Shell t={t} onBack={onBack}>
      <Header t={t} template={template} assignment={assignment} />
      {stopped ? (
        <StoppedNotice t={t} />
      ) : (
        template.mode === 'bank' ? (
          <BankExam t={t} template={template} answered={answered} onSubmitDone={setFinalReport} />
        ) : (
          <OralExam t={t} template={template} answered={answered} onSubmitDone={setFinalReport} />
        )
      )}
    </Shell>
  );
}

// ──────────────────────────────────────────────────────
// 外壳 + 顶栏
// ──────────────────────────────────────────────────────
function Shell({ t, onBack, children }) {
  return (
    <div style={{ minHeight: '100%', background: t.bg, color: t.text, display: 'flex', flexDirection: 'column' }}>
      <BrandBar t={t} onBack={onBack} />
      <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '12px 18px 28px' }}>
        {children}
      </div>
    </div>
  );
}

function BrandBar({ t, onBack }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 18px 6px',
    }}>
      {onBack ? (
        <span
          onClick={onBack}
          style={{
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
            color: t.textMute, fontSize: 13, letterSpacing: '0.04em', fontWeight: 600,
          }}
        >
          <Icon name="back" size={14} color={t.textMute} stroke={2} />
          <span>返回</span>
        </span>
      ) : (
        <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.16em', fontWeight: 700 }}>
          SIMUGO · 来自学员端
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: t.text, letterSpacing: '0.04em' }}>SIMUGO</div>
        <div style={{ fontSize: 10, color: t.textMute, fontWeight: 700, letterSpacing: '0.16em' }}>考 核</div>
      </div>
    </div>
  );
}

function Header({ t, template, assignment }) {
  const modeLabel = template.mode === 'bank' ? '固定题库' : 'AI 主考';
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase' }}>
        考核任务 · {STATUS_LABEL[assignment.status] || assignment.status}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: t.text, marginTop: 6, letterSpacing: '-0.005em' }}>
        {template.title}
      </div>
      <div style={{ fontSize: 12.5, color: t.textSoft, marginTop: 6 }}>
        {modeLabel} · {template.num_questions} 题 · 及格分 {template.pass_score}
        {assignment.due_at && ` · 截止 ${assignment.due_at.slice(0, 16).replace('T', ' ')}`}
      </div>
    </div>
  );
}

function StoppedNotice({ t }) {
  return (
    <div style={{ ...neuRaised(t, 18), padding: 22, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.text, marginBottom: 8 }}>考核已停止</div>
      <div style={{ color: t.textSoft, lineHeight: 1.6 }}>
        这份考核已由管理员停止，不能继续作答或提交。如需重新参加，请联系发起人重新分配或催办。
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 通用按钮
// ──────────────────────────────────────────────────────
function PrimaryBtn({ t, disabled, onClick, children }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        background: t.accent, color: '#fff', border: 'none',
        borderRadius: 999, padding: '9px 22px', fontSize: 14, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: `2px 2px 6px ${t.sDark}, -2px -2px 6px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)`,
      }}
    >{children}</button>
  );
}
function GhostBtn({ t, disabled, onClick, children }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        background: t.surface, color: t.text, border: 'none',
        borderRadius: 999, padding: '9px 18px', fontSize: 14, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        boxShadow: `2px 2px 5px ${t.sDark}, -2px -2px 5px ${t.sLight}`,
      }}
    >{children}</button>
  );
}

// ──────────────────────────────────────────────────────
// 固定题库
// ──────────────────────────────────────────────────────
function BankExam({ t, template, answered, onSubmitDone }) {
  const questions = template.questions || [];
  const initialAnswered = useMemo(() => {
    const m = new Map();
    (answered || []).forEach((r) => m.set(r.turn_idx, r));
    return m;
  }, [answered]);
  const firstUnanswered = questions.findIndex((q) => !initialAnswered.has(q.idx));
  const [idx, setIdx] = useState(firstUnanswered === -1 ? Math.max(questions.length - 1, 0) : firstUnanswered);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastFeedback, setLastFeedback] = useState(null);
  const [finalizing, setFinalizing] = useState(false);

  const current = questions[idx];
  const already = current ? initialAnswered.get(current.idx) : null;

  useEffect(() => {
    setDraft(already?.answer_text || '');
    setLastFeedback(already
      ? { ai_score: already.ai_score, ai_feedback: already.ai_feedback || {} }
      : null);
  }, [idx, already]);

  if (!questions.length) {
    return (
      <div style={{ ...neuRaised(t, 18), padding: 24, color: t.textSoft, textAlign: 'center' }}>
        这份考核还没有题目，可能还在准备中。
      </div>
    );
  }

  const submitCurrent = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      const out = await submitBankAnswer(current.idx, draft);
      setLastFeedback(out);
      initialAnswered.set(current.idx, {
        ...current, answer_text: draft, ai_score: out.ai_score, ai_feedback: out.ai_feedback,
      });
    } catch (e) {
      alert('提交失败：' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const allDone = questions.every((q) => initialAnswered.has(q.idx));
  const finalize = async () => {
    setFinalizing(true);
    try {
      const r = await submitAssignment();
      onSubmitDone(r);
    } catch (e) {
      alert('交卷失败：' + (e.message || e));
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div>
      <div style={{ color: t.textMute, fontSize: 12, marginBottom: 8, letterSpacing: '0.04em' }}>
        第 {idx + 1} / {questions.length} 题
      </div>
      <div style={{ height: 6, ...neuInset(t, 999, 0.4), position: 'relative', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${((idx + 1) / questions.length) * 100}%`,
          background: `linear-gradient(90deg, ${t.accent}, ${t.accentSoft})`,
          transition: 'width .4s ease',
        }} />
      </div>

      <div style={{ ...neuRaised(t, 18), padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 12, lineHeight: 1.45 }}>
          {current.text}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          placeholder="请输入你的回答…"
          disabled={submitting}
          style={{
            width: '100%', fontFamily: 'inherit', fontSize: 14, color: t.text,
            border: 'none', outline: 'none', resize: 'vertical',
            padding: 12, borderRadius: 12,
            ...neuInset(t, 12, 0.6),
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <GhostBtn t={t} disabled={idx === 0} onClick={() => setIdx(idx - 1)}>上一题</GhostBtn>
          <PrimaryBtn t={t} disabled={submitting || !draft.trim()} onClick={submitCurrent}>
            {submitting ? '评分中…' : already ? '重新提交' : '提交评分'}
          </PrimaryBtn>
        </div>
      </div>

      {lastFeedback && <FeedbackCard t={t} fb={lastFeedback} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <GhostBtn t={t} disabled={idx >= questions.length - 1} onClick={() => setIdx(idx + 1)}>
          下一题
        </GhostBtn>
        <PrimaryBtn t={t} disabled={!allDone || finalizing} onClick={finalize}>
          {finalizing ? '提交中…' : allDone ? '全部交卷' : `还差 ${questions.length - initialAnswered.size} 题`}
        </PrimaryBtn>
      </div>
    </div>
  );
}

function FeedbackCard({ t, fb }) {
  if (!fb) return null;
  const score = typeof fb.ai_score === 'number' ? fb.ai_score.toFixed(1) : '-';
  const fbObj = fb.ai_feedback || {};
  const scoreColor = typeof fb.ai_score === 'number'
    ? (fb.ai_score >= 80 ? t.good || '#2a8a3e' : fb.ai_score >= 60 ? t.accent : '#a4571f')
    : t.textMute;
  return (
    <div style={{ ...neuRaised(t, 18), padding: 16, marginTop: 12, background: t.surface2 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor }}>{score}</div>
        <div style={{ fontSize: 12, color: t.textMute, letterSpacing: '0.08em', fontWeight: 600 }}>AI 评分</div>
      </div>
      {Array.isArray(fbObj.rubric_breakdown) && fbObj.rubric_breakdown.length > 0 && (
        <ul style={{ paddingLeft: 0, marginTop: 10, listStyle: 'none' }}>
          {fbObj.rubric_breakdown.map((rb, i) => {
            const tagColor = rb.status === 'hit' ? (t.good || '#2a8a3e')
              : rb.status === 'partial' ? '#c79a4f'
              : '#a4571f';
            return (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                <span style={{
                  flexShrink: 0,
                  display: 'inline-block', minWidth: 46,
                  textAlign: 'center', borderRadius: 4,
                  fontSize: 10, padding: '3px 6px', letterSpacing: '0.06em', fontWeight: 700,
                  background: `${tagColor}1a`, color: tagColor,
                }}>
                  {rb.status?.toUpperCase() || ''}
                </span>
                <div style={{ color: t.text, fontSize: 13.5, lineHeight: 1.5 }}>
                  {rb.point}
                  {rb.note && <span style={{ color: t.textSoft }}> — {rb.note}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {Array.isArray(fbObj.missing_points) && fbObj.missing_points.length > 0 && (
        <div style={{ color: '#a4571f', fontSize: 12.5, marginTop: 6 }}>
          遗漏要点：{fbObj.missing_points.join('；')}
        </div>
      )}
      {fbObj.comment && (
        <div style={{ color: t.textSoft, fontSize: 13, marginTop: 8, fontStyle: 'italic' }}>
          {fbObj.comment}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// AI 主考
// ──────────────────────────────────────────────────────
function OralExam({ t, template, answered, onSubmitDone }) {
  const [turns, setTurns] = useState(() => (answered || []).map((r) => ({
    q: r.question_text, a: r.answer_text, score: r.ai_score,
    feedback: r.ai_feedback, ref_kp_ids: (r.ai_feedback && r.ai_feedback.kp_tags) || [],
  })));
  const [intro, setIntro] = useState(() => !(answered || []).length);
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextError, setNextError] = useState('');
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(template.num_questions || 5);
  const [finalizing, setFinalizing] = useState(false);
  const fetchedRef = useRef(false);

  const fetchNext = async () => {
    if (done) return;
    setBusy(true);
    setNextError('');
    try {
      const r = await oralNext();
      if (typeof r.total === 'number' && r.total > 0) setTotal(r.total);
      if (r.done) { setDone(true); setPending(null); }
      else setPending({
        turn_idx: r.turn_idx,
        question_text: r.question_text,
        ref_kp_ids: r.ref_kp_ids || [],
        ref_chunk_ids: r.ref_chunk_ids || [],
        focus_dimension: r.focus_dimension || '',
        source_mode: r.source_mode || '',
        is_fallback: !!r.is_fallback,
      });
    } catch (e) {
      setNextError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    if (intro) return;
    if (turns.length < (template.num_questions || 5)) fetchNext();
    else setDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro]);

  const submitAnswer = async () => {
    if (!pending || !draft.trim()) return;
    setBusy(true);
    try {
      const answeredTurn = {
        q: pending.question_text,
        a: draft,
        focus_dimension: pending.focus_dimension,
        source_mode: pending.source_mode,
        is_fallback: pending.is_fallback,
        ref_kp_ids: pending.ref_kp_ids,
      };
      const out = await oralAnswer({
        turn_idx: pending.turn_idx,
        question_text: pending.question_text,
        answer_text: draft,
        ref_kp_ids: pending.ref_kp_ids,
        ref_chunk_ids: pending.ref_chunk_ids,
      });
      setTurns((arr) => [
        ...arr,
        { ...answeredTurn, score: out.ai_score, feedback: out.ai_feedback },
      ]);
      setPending(null);
      setDraft('');
      await fetchNext();
    } catch (e) {
      alert('提交失败：' + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    const ok = window.confirm(`确认交卷？\n\n已完成 ${turns.length} / ${total} 轮，交卷后将生成综合评价，且不能继续作答。`);
    if (!ok) return;
    setFinalizing(true);
    try {
      const r = await submitAssignment();
      onSubmitDone(r);
    } catch (e) {
      alert('交卷失败：' + (e.message || e));
    } finally {
      setFinalizing(false);
    }
  };

  const currentRound = done
    ? total
    : pending
      ? pending.turn_idx + 1
      : Math.min(turns.length + 1, total);
  const statusText = done
    ? '全部题目已完成'
    : pending
      ? (busy ? 'AI 正在评分本轮回答' : '请完成当前作答')
      : busy
        ? `正在生成第 ${currentRound} 轮题目`
        : nextError
          ? '出题遇到问题'
          : '准备进入下一轮';

  if (intro) {
    return (
      <OralIntro
        t={t}
        template={template}
        onStart={() => {
          setIntro(false);
          fetchNext();
        }}
      />
    );
  }

  return (
    <div>
      <OralProgress
        t={t}
        currentRound={currentRound}
        total={total}
        completed={turns.length}
        statusText={statusText}
      />

      {pending && (
        <CurrentQuestionCard
          t={t}
          pending={pending}
          currentRound={currentRound}
          total={total}
          completed={turns.length}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onSubmit={submitAnswer}
        />
      )}

      {!pending && !done && busy && (
        <OralLoadingCard t={t} round={currentRound} />
      )}

      {!pending && !done && !busy && nextError && (
        <div style={{ ...neuRaised(t, 18), padding: 18, textAlign: 'center', color: t.textSoft, marginBottom: 12 }}>
          <div style={{
            width: 34, height: 34, margin: '0 auto 10px', borderRadius: 999,
            background: `${t.warn || t.accentSoft}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="alert" size={17} color={t.warn || t.accentSoft} stroke={2.2} />
          </div>
          <div style={{ marginBottom: 8, color: t.text, fontWeight: 700 }}>AI 出题失败，可以重试本轮。</div>
          <div style={{ fontSize: 12, color: t.textMute, marginBottom: 14, lineHeight: 1.5 }}>{nextError}</div>
          <GhostBtn t={t} onClick={fetchNext}>重新出题</GhostBtn>
        </div>
      )}

      {done && (
        <div style={{ ...neuRaised(t, 18), textAlign: 'center', padding: 20, marginTop: 14 }}>
          <div style={{
            width: 40, height: 40, margin: '0 auto 10px', borderRadius: 999,
            background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `2px 2px 6px ${t.sDark}, -2px -2px 6px ${t.sLight}`,
          }}>
            <Icon name="check" size={21} color="#fff" stroke={2.4} />
          </div>
          <div style={{ color: t.text, fontSize: 17, fontWeight: 800, marginBottom: 5 }}>
            AI 主考已完成
          </div>
          <div style={{ color: t.textSoft, fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            共完成 {turns.length} 轮作答。提交后将生成综合评价，并结束本次 AI 主考。
          </div>
          <PrimaryBtn t={t} disabled={finalizing} onClick={finalize}>
            {finalizing ? '生成评价中…' : '提交，看综合评价'}
          </PrimaryBtn>
        </div>
      )}

      {turns.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: t.textMute, fontWeight: 700, letterSpacing: '0.08em', margin: '0 0 8px 2px' }}>
            已完成轮次
          </div>
          {turns.map((tn, i) => (
            <AnsweredTurnCard key={i} t={t} turn={tn} idx={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function OralIntro({ t, template, onStart }) {
  const rounds = template.num_questions || 5;
  const rows = [
    ['逐轮出题', `AI 会围绕本次考核范围连续提出约 ${rounds} 轮问题。`],
    ['即时评分', '每轮提交后会立即评分，并保留已完成轮次。'],
    ['最终评价', '完成全部轮次后交卷，系统会生成综合评价和知识点表现。'],
    ['作答规则', '每轮提交后不能撤回本轮答案；中途返回后可继续未完成轮次。'],
  ];
  return (
    <div style={{ ...neuRaised(t, 18), padding: 20 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 16,
        background: `${t.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
      }}>
        <Icon name="sparkle" size={22} color={t.accent} stroke={2.3} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 850, color: t.text, marginBottom: 6 }}>
        开始 AI 主考前，请先确认流程
      </div>
      <div style={{ fontSize: 13, color: t.textSoft, lineHeight: 1.6, marginBottom: 16 }}>
        这不是固定题库。AI 会根据考核范围逐轮提问，并结合你的回答生成评分与最终反馈。
      </div>
      <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
        {rows.map(([title, desc]) => (
          <div key={title} style={{
            ...neuInset(t, 14, 0.45),
            padding: '11px 12px',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}>
            <div style={{
              flexShrink: 0,
              width: 7,
              height: 7,
              borderRadius: 999,
              background: t.accent,
              marginTop: 7,
            }} />
            <div>
              <div style={{ color: t.text, fontSize: 13.5, fontWeight: 800 }}>{title}</div>
              <div style={{ color: t.textSoft, fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryBtn t={t} onClick={onStart}>开始第 1 轮</PrimaryBtn>
      </div>
    </div>
  );
}

function OralProgress({ t, currentRound, total, completed, statusText }) {
  const safeTotal = Math.max(1, total || 1);
  const pct = Math.max(0, Math.min(100, (completed / safeTotal) * 100));
  return (
    <div style={{ ...neuRaised(t, 18), padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.12em', fontWeight: 800 }}>
            AI 主考进度
          </div>
          <div style={{ fontSize: 20, color: t.text, fontWeight: 800, marginTop: 4 }}>
            第 {currentRound} / {safeTotal} 轮
          </div>
        </div>
        <div style={{ color: t.textSoft, fontSize: 12.5, fontWeight: 600, textAlign: 'right', lineHeight: 1.4 }}>
          {statusText}
        </div>
      </div>
      <div style={{ height: 7, ...neuInset(t, 999, 0.45), position: 'relative', overflow: 'hidden', marginTop: 14 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${t.accent}, ${t.accentSoft})`,
          borderRadius: 999,
          transition: 'width .35s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: t.textMute, fontSize: 11 }}>
        <span>已完成 {completed} 轮</span>
        <span>共 {safeTotal} 轮</span>
      </div>
    </div>
  );
}

function CurrentQuestionCard({ t, pending, currentRound, total, completed, draft, setDraft, busy, onSubmit }) {
  const note = pending.is_fallback
    ? '系统已为你生成一道基础题'
    : '请围绕本轮考察方向作答';
  const remaining = Math.max(0, (total || 0) - completed - 1);
  return (
    <div style={{ ...neuRaised(t, 18), padding: 18, marginBottom: 12, borderLeft: `3px solid ${t.accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: `${t.accent}18`, color: t.accent,
          borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 800,
        }}>
          <Icon name="target" size={13} color={t.accent} stroke={2.2} />
          本轮考察：{pending.focus_dimension || '综合表达'}
        </span>
        <span style={{
          display: 'inline-flex',
          background: t.surface2,
          color: t.textSoft,
          borderRadius: 999,
          padding: '5px 10px',
          fontSize: 12,
          fontWeight: 750,
        }}>
          第 {currentRound} / {total || 1} 轮 · 后续约 {remaining} 轮
        </span>
        <span style={{ color: t.textMute, fontSize: 12 }}>{note}</span>
      </div>
      {pending.is_fallback && (
        <div style={{
          color: t.textSoft,
          background: `${t.accentSoft || t.accent}16`,
          borderRadius: 12,
          padding: '9px 11px',
          fontSize: 12.5,
          lineHeight: 1.5,
          marginBottom: 12,
        }}>
          本轮使用基础题模式，仍会按你的作答完整评分。
        </div>
      )}
      <div style={{ fontWeight: 800, color: t.text, marginBottom: 12, fontSize: 17, lineHeight: 1.5 }}>
        AI：{pending.question_text}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        placeholder="请作答…"
        disabled={busy}
        style={{
          width: '100%', fontFamily: 'inherit', fontSize: 14, color: t.text,
          border: 'none', outline: 'none', resize: 'vertical',
          padding: 12, borderRadius: 12, ...neuInset(t, 12, 0.6),
          lineHeight: 1.55,
        }}
      />
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ color: t.textMute, fontSize: 12 }}>提交后 AI 会立即给出本轮评分。</div>
        <PrimaryBtn t={t} disabled={busy || !draft.trim()} onClick={onSubmit}>
          {busy ? '评分中…' : '提交本轮'}
        </PrimaryBtn>
      </div>
    </div>
  );
}

function AnsweredTurnCard({ t, turn, idx }) {
  const [expanded, setExpanded] = useState(false);
  const score = typeof turn.score === 'number' ? turn.score.toFixed(1) : '-';
  const scoreColor = typeof turn.score === 'number'
    ? (turn.score >= 80 ? t.good || '#2a8a3e' : turn.score >= 60 ? t.accent : '#a4571f')
    : t.textMute;
  const feedback = turn.feedback || {};
  const kpTags = Array.isArray(feedback.kp_tags) ? feedback.kp_tags : (turn.ref_kp_ids || []);
  const answer = turn.a || '';
  const compactAnswer = !expanded && answer.length > 120 ? `${answer.slice(0, 120)}...` : answer;
  return (
    <div style={{
      ...neuRaised(t, 14, 0.7),
      padding: '12px 14px',
      marginBottom: 10,
      background: t.surface,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 7 }}>
        <div style={{ color: t.textMute, fontSize: 11, letterSpacing: '0.1em', fontWeight: 800 }}>
          第 {idx + 1} 轮
        </div>
        <div style={{ color: scoreColor, fontSize: 12, fontWeight: 800 }}>
          {score} 分
        </div>
      </div>
      {turn.focus_dimension && (
        <div style={{ color: t.accent, fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
          {turn.focus_dimension}
        </div>
      )}
      <div style={{ color: t.text, fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>
        AI：{turn.q}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', color: t.textSoft, marginTop: 5, fontSize: 13, lineHeight: 1.5 }}>
        你：{compactAnswer}
      </div>
      {answer.length > 120 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            border: 'none',
            background: 'transparent',
            color: t.accent,
            padding: '5px 0 0',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {expanded ? '收起答案' : '展开完整答案'}
        </button>
      )}
      {feedback.comment && (
        <div style={{
          marginTop: 9,
          padding: '9px 10px',
          borderRadius: 12,
          background: t.surface2,
          color: t.textSoft,
          fontSize: 12.5,
          lineHeight: 1.5,
        }}>
          AI 反馈：{feedback.comment}
        </div>
      )}
      {kpTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {kpTags.map((kid, i) => (
            <span key={`${kid}-${i}`} style={{
              borderRadius: 999,
              background: `${t.accent}14`,
              color: t.accent,
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 750,
            }}>
              KP {kid}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function OralLoadingCard({ t, round }) {
  return (
    <div style={{ ...neuRaised(t, 18), padding: 20, textAlign: 'center', color: t.textSoft, marginBottom: 12 }}>
      <div style={{
        width: 38, height: 38, margin: '0 auto 11px', borderRadius: 999,
        background: `${t.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="sparkle" size={18} color={t.accent} stroke={2.2} />
      </div>
      <div style={{ color: t.text, fontSize: 16, fontWeight: 800, marginBottom: 5 }}>
        正在生成第 {round} 轮题目
      </div>
      <div style={{ color: t.textMute, fontSize: 12.5 }}>
        AI 会根据考核范围和上一轮回答切换考察方向。
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 终局报告
// ──────────────────────────────────────────────────────
function FinalReport({ t, report, template, onBack }) {
  const pass = report.passed;
  const scoreColor = pass ? (t.good || '#2a8a3e') : '#a4571f';
  const strengths = Array.isArray(report.summary?.strengths) ? report.summary.strengths : [];
  const weaknesses = Array.isArray(report.summary?.weaknesses) ? report.summary.weaknesses : [];
  const nextActions = weaknesses.length
    ? weaknesses.slice(0, 3).map((s) => `针对「${s}」再做一次情景演练或复习对应知识点。`)
    : ['保持当前节奏，后续可用 AI 答疑复盘本次表现。'];
  return (
    <div style={{ paddingTop: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.16em', fontWeight: 700 }}>{template.title}</div>
      <div style={{ fontSize: 56, fontWeight: 800, margin: '14px 0 4px', color: scoreColor, letterSpacing: '-0.02em' }}>
        {report.score.toFixed(1)}
      </div>
      <div style={{ color: t.textSoft, fontSize: 13 }}>{pass ? '✅ 已通过' : `未达到及格分 ${report.pass_score}`}</div>

      {Array.isArray(report.by_kp) && report.by_kp.length > 0 && (
        <div style={{ ...neuRaised(t, 18), padding: 18, marginTop: 22, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, color: t.text, marginBottom: 12 }}>按知识点表现</div>
          {report.by_kp.map((k) => {
            const c = k.avg_score >= 60 ? (t.good || '#2a8a3e') : '#a4571f';
            return (
              <div key={k.kp_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 70, color: t.textMute, fontSize: 12 }}>KP {k.kp_id}</div>
                <div style={{ flex: 1, height: 6, ...neuInset(t, 999, 0.4), position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${Math.max(0, Math.min(100, k.avg_score))}%`,
                    background: c, borderRadius: 999,
                  }} />
                </div>
                <div style={{ width: 50, textAlign: 'right', fontSize: 13, color: t.text }}>{k.avg_score.toFixed(0)}</div>
              </div>
            );
          })}
        </div>
      )}

      {report.summary && (report.summary.summary || strengths.length || weaknesses.length) && (
        <div style={{ ...neuRaised(t, 18), padding: 18, marginTop: 14, textAlign: 'left', color: t.text }}>
          {report.summary.summary && <p style={{ marginTop: 0 }}>{report.summary.summary}</p>}
          {strengths.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, color: t.text }}>亮点</div>
              <ul>{strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, color: t.text }}>待改进</div>
              <ul>{weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div style={{ ...neuRaised(t, 18), padding: 18, marginTop: 14, textAlign: 'left' }}>
        <div style={{ fontWeight: 800, color: t.text, marginBottom: 10 }}>下一步建议</div>
        <ul style={{ color: t.textSoft, fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>
          {nextActions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
        <PrimaryBtn t={t} onClick={onBack || (() => window.location.assign(window.location.origin))}>
          返回主页
        </PrimaryBtn>
      </div>
      <p style={{ color: t.textMute, marginTop: 14, fontSize: 12 }}>本次考核已结束。</p>
    </div>
  );
}
