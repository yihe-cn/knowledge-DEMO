// screens-notes.jsx — "我的笔记"：员工的问答 / 突击历史
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { neuFlat, neuRaised, neuInset } from "../theme.js";
import { Card, PillButton, Icon, TopBar } from "../components/Primitives.jsx";

const NOTES_KEY = 'simugo.notes.v1';
const NOTES_LIMIT = 100; // 最多保留 100 条，超出删最老

// ─── 存储工具 ──────────────────────────────────────────────────
const Notes = {
  load() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; }
    catch (e) { return []; }
  },
  save(notes) {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes.slice(0, NOTES_LIMIT))); }
    catch (e) { /* quota or other — ignore */ }
  },
  add(note) {
    const all = Notes.load();
    const withId = { ...note, id: note.id || `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: note.timestamp || Date.now() };
    const next = [withId, ...all];
    Notes.save(next);
    return withId;
  },
  upsert(note) {
    if (!note.id) return Notes.add(note);
    const all = Notes.load();
    const idx = all.findIndex(n => n.id === note.id);
    if (idx >= 0) {
      // 更新但保留原 timestamp
      all[idx] = { ...all[idx], ...note, timestamp: all[idx].timestamp };
      Notes.save(all);
    } else {
      Notes.save([{ ...note, timestamp: note.timestamp || Date.now() }, ...all]);
    }
    return note;
  },
  remove(id) {
    Notes.save(Notes.load().filter(n => n.id !== id));
  },
  clear() {
    Notes.save([]);
  },
  count() {
    return Notes.load().length;
  },
};

window.SIMUGO_NOTES = Notes;

// ─── Hook：订阅笔记数量（轻量轮询 + 自定义 event） ──
function useNotesCount() {
  const [count, setCount] = useState(() => Notes.count());
  useEffect(() => {
    const refresh = () => setCount(Notes.count());
    window.addEventListener('simugo-notes-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('simugo-notes-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return count;
}
window.useNotesCount = useNotesCount;

// 通知变化
function notifyNotesChanged() {
  window.dispatchEvent(new CustomEvent('simugo-notes-changed'));
}
window.notifyNotesChanged = notifyNotesChanged;

// ─── 笔记屏 ──────────────────────────────────────────────────
function NotesScreen({ t, go }) {
  const [notes, setNotes] = useState(() => Notes.load());
  const [filter, setFilter] = useState('all'); // all | chat | quiz
  const [openId, setOpenId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = () => setNotes(Notes.load());

  const filtered = useMemo(() => {
    if (filter === 'all') return notes;
    return notes.filter(n => n.type === filter);
  }, [notes, filter]);

  const counts = useMemo(() => ({
    all: notes.length,
    chat: notes.filter(n => n.type === 'chat').length,
    quiz: notes.filter(n => n.type === 'quiz').length,
  }), [notes]);

  const remove = (id) => {
    Notes.remove(id);
    notifyNotesChanged();
    refresh();
    if (openId === id) setOpenId(null);
  };

  const openNote = notes.find(n => n.id === openId);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <TopBar t={t} title="我的笔记" onBack={() => go('home')}
        right={notes.length > 0 ? (
          confirmClear ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div onClick={() => {
                Notes.clear(); notifyNotesChanged(); refresh(); setConfirmClear(false);
              }} style={{
                ...neuFlat(t, 999), padding: '6px 11px', cursor: 'pointer',
                fontSize: 11, color: t.bad, fontWeight: 700,
              }}>确认清空</div>
              <div onClick={() => setConfirmClear(false)} style={{
                ...neuFlat(t, 999), padding: '6px 11px', cursor: 'pointer',
                fontSize: 11, color: t.textMute, fontWeight: 600,
              }}>取消</div>
            </div>
          ) : (
            <div onClick={() => setConfirmClear(true)} style={{
              ...neuFlat(t, 999), padding: '6px 11px', cursor: 'pointer',
              fontSize: 11, color: t.textMute, fontWeight: 600,
            }}>清空</div>
          )
        ) : null}
      />

      {/* Filter segmented */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ ...neuInset(t, 14, 0.6), padding: 3, display: 'flex', gap: 3 }}>
          {[
            { v: 'all', label: '全部', n: counts.all },
            { v: 'chat', label: '💬 答疑', n: counts.chat },
            { v: 'quiz', label: '⚡ 突击', n: counts.quiz },
          ].map(o => {
            const active = filter === o.v;
            return (
              <div key={o.v} onClick={() => setFilter(o.v)} style={{
                flex: 1, padding: '8px 6px', borderRadius: 11, cursor: 'pointer',
                textAlign: 'center',
                background: active ? `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})` : 'transparent',
                boxShadow: active ? `2px 2px 4px ${t.sDark}, -1px -1px 3px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)` : 'none',
                fontSize: 12, fontWeight: 700,
                color: active ? '#fff' : t.textSoft,
                transition: 'all .2s ease',
              }}>
                {o.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>{o.n}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 20px' }}>
        {filtered.length === 0 ? (
          <NotesEmpty t={t} filter={filter} go={go} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(n => (
              <NoteCard key={n.id} t={t} note={n} onOpen={() => setOpenId(n.id)} onDelete={() => remove(n.id)} />
            ))}
          </div>
        )}
      </div>

      {openNote && (
        <NoteDetailSheet t={t} note={openNote} onClose={() => setOpenId(null)} onDelete={() => remove(openNote.id)} />
      )}
    </div>
  );
}

// ─── 空态 ─────────────────────────────────────────────────────
function NotesEmpty({ t, filter, go }) {
  const messages = {
    all: { icon: '📔', title: '还没有笔记', sub: '你和 AI 的每次对话、每次突击都会自动存这里' },
    chat: { icon: '💬', title: '还没有答疑记录', sub: '去"问 AI"提问，对话会自动留下' },
    quiz: { icon: '⚡', title: '还没有突击记录', sub: '去"AI 考我"答几道题试试' },
  };
  const m = messages[filter] || messages.all;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 20px' }}>
      <div style={{
        width: 64, height: 64, borderRadius: 20, marginBottom: 16,
        ...neuInset(t, 20, 0.6),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 26,
      }}>{m.icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 6 }}>{m.title}</div>
      <div style={{ fontSize: 12.5, color: t.textSoft, lineHeight: 1.55, marginBottom: 20, maxWidth: 240 }}>{m.sub}</div>
      <PillButton t={t} primary onClick={() => go('aiqa')}>去 AI 答疑</PillButton>
    </div>
  );
}

// ─── 笔记卡 ───────────────────────────────────────────────────
function NoteCard({ t, note, onOpen, onDelete }) {
  const isChat = note.type === 'chat';
  const isQuiz = note.type === 'quiz';
  const tagColor = isChat ? t.accent : t.warn;

  let title, sub, badge;
  if (isChat) {
    const firstUserMsg = (note.messages || []).find(m => m.role === 'user');
    title = firstUserMsg ? firstUserMsg.text : '答疑对话';
    sub = `${(note.messages || []).filter(m => m.role === 'user').length} 个提问`;
    badge = '💬 答疑';
  } else {
    const customer = window.SIMUGO_DATA.CUSTOMER_INDEX[note.customerId] || { name: '客户' };
    title = `${customer.name}的突击 · ${note.score} 分`;
    const counts = { good: 0, mid: 0, bad: 0 };
    (note.results || []).forEach(r => { if (counts[r.rating] !== undefined) counts[r.rating]++; });
    sub = `共 ${(note.results || []).length} 题 · ✅${counts.good} ⚠️${counts.mid} ❌${counts.bad}`;
    badge = '⚡ 突击';
  }

  return (
    <div style={{
      ...neuFlat(t, 16), padding: '14px 14px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      cursor: 'pointer', position: 'relative',
    }} onClick={onOpen}>
      <div style={{
        width: 38, height: 38, borderRadius: 12, flexShrink: 0,
        background: `${tagColor}1a`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17,
      }}>
        {isChat ? '💬' : '⚡'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: tagColor, fontWeight: 700, letterSpacing: '0.05em' }}>{badge}</span>
          <span style={{ fontSize: 10, color: t.textMute }}>· {formatTime(note.timestamp)}</span>
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: t.text, lineHeight: 1.4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</div>
        <div style={{ fontSize: 11.5, color: t.textSoft, marginTop: 4 }}>{sub}</div>

        {/* 关联 KP */}
        {note.contextKpId && (() => {
          const ref = window.SIMUGO_DATA.KP_INDEX[note.contextKpId];
          if (!ref) return null;
          return (
            <div style={{
              marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 999,
              background: t.surface2, fontSize: 10.5, color: t.textSoft, fontWeight: 600,
            }}>
              {ref.module.icon} {ref.point.title}
            </div>
          );
        })()}
      </div>
      <div onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{
        width: 26, height: 26, borderRadius: 999, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', opacity: 0.4,
      }}>
        <Icon name="close" size={13} color={t.textSoft} stroke={2} />
      </div>
    </div>
  );
}

// ─── 详情 sheet ──────────────────────────────────────────────
function NoteDetailSheet({ t, note, onClose, onDelete }) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 50, animation: 'notesFadeIn .2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxHeight: '85%',
        background: t.bg, borderRadius: '24px 24px 0 0',
        padding: '14px 0 0', overflow: 'hidden',
        boxShadow: `0 -10px 30px rgba(0,0,0,0.25)`,
        display: 'flex', flexDirection: 'column',
        animation: 'notesSlideUp .25s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: t.textMute, opacity: 0.5 }} />
        </div>
        <div style={{ padding: '0 22px 8px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>
            {note.type === 'chat' ? '💬 答疑回顾' : '⚡ 突击回顾'}
          </div>
          <div style={{ fontSize: 11, color: t.textMute, flex: 1 }}>{formatTime(note.timestamp, true)}</div>
          <div onClick={onDelete} style={{
            ...neuFlat(t, 999), padding: '5px 10px', cursor: 'pointer',
            fontSize: 10.5, color: t.bad, fontWeight: 600,
          }}>删除</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 22px 26px' }}>
          {note.type === 'chat' ? <ChatReplay t={t} note={note} /> : <QuizReplay t={t} note={note} />}
        </div>
        <style>{`
          @keyframes notesFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes notesSlideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        `}</style>
      </div>
    </div>
  );
}

function ChatReplay({ t, note }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(note.messages || []).map((m, i) => (
        <div key={i} style={{
          alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
          maxWidth: '88%',
        }}>
          <div style={{ fontSize: 10, color: t.textMute, fontWeight: 600, marginBottom: 3, paddingLeft: m.role === 'user' ? 0 : 4, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            {m.role === 'user' ? '我' : 'AI 私教'}
          </div>
          <div style={{
            padding: '10px 13px', borderRadius: 14,
            background: m.role === 'user' ? t.accent : t.surface2,
            color: m.role === 'user' ? '#fff' : t.text,
            fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
            boxShadow: m.role === 'user'
              ? `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`
              : `1.5px 1.5px 3px ${t.sDark}, -1.5px -1.5px 3px ${t.sLight}`,
          }}>{m.text}</div>
          {m.role === 'ai' && m.citations && m.citations.length > 0 && (
            <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {m.citations.map(id => {
                const ref = window.SIMUGO_DATA.KP_INDEX[id];
                if (!ref) return null;
                return (
                  <div key={id} style={{
                    padding: '3px 8px', borderRadius: 999, background: t.surface,
                    fontSize: 10, color: t.textSoft, fontWeight: 600,
                  }}>{ref.point.title}</div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function QuizReplay({ t, note }) {
  const customer = window.SIMUGO_DATA.CUSTOMER_INDEX[note.customerId] || window.SIMUGO_DATA.CUSTOMERS[0];
  const ratingStyle = {
    good: { icon: '✅', label: '不错', color: t.good },
    mid:  { icon: '⚠️', label: '可以更好', color: t.warn },
    bad:  { icon: '❌', label: '冷场', color: t.bad },
  };
  return (
    <div>
      {/* 总分小条 */}
      <div style={{
        ...neuFlat(t, 14), padding: '10px 14px', marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ fontSize: 22 }}>{customer.emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: t.text, fontWeight: 600 }}>{customer.name} · {customer.vibe}</div>
          <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 1 }}>共 {note.results.length} 题</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: t.accent }}>{note.score}<span style={{ fontSize: 11, color: t.textMute, fontWeight: 600 }}>分</span></div>
      </div>

      {/* 每题回看 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {note.results.map((r, i) => {
          const rs = ratingStyle[r.rating] || ratingStyle.mid;
          const kp = window.SIMUGO_DATA.KP_INDEX[r.question.primaryKpId];
          return (
            <div key={i}>
              <div style={{ fontSize: 10.5, color: t.textMute, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 6 }}>
                第 {i + 1} 题 · {r.question.type}
              </div>
              {/* customer question */}
              <div style={{ ...neuFlat(t, 14), padding: '10px 13px', marginBottom: 6, fontSize: 13, color: t.text, lineHeight: 1.5 }}>
                {customer.avatar}：{r.question.text}
              </div>
              {/* student answer */}
              <div style={{
                padding: '10px 13px', borderRadius: 14, background: t.accent, color: '#fff',
                fontSize: 12.5, lineHeight: 1.55, marginBottom: 6,
                boxShadow: `2px 2px 5px ${t.sDark}, -1px -1px 3px ${t.sLight}`,
              }}>
                我：{r.studentAnswer}
              </div>
              {/* grade */}
              <div style={{
                padding: '10px 13px', borderRadius: 14,
                background: `${rs.color}15`, border: `1px solid ${rs.color}30`,
                fontSize: 12, color: t.text, lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, color: rs.color, marginBottom: 4 }}>{rs.icon} {rs.label}</div>
                <div>{r.comment}</div>
                {r.referenceAnswer && (
                  <div style={{ marginTop: 6, padding: '8px 10px', background: t.surface, borderRadius: 8, fontSize: 11.5, color: t.textSoft, lineHeight: 1.55 }}>
                    <span style={{ color: t.accent, fontWeight: 700 }}>参考 · </span>{r.referenceAnswer}
                  </div>
                )}
                {kp && (
                  <div style={{ marginTop: 6, fontSize: 10.5, color: t.textMute }}>
                    📖 {kp.point.title}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 工具 ────────────────────────────────────────────────────
function formatTime(ts, detail = false) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (!detail) {
    if (diff < min) return '刚刚';
    if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  }
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${dd} ${hh}:${mm}`;
}

export { NotesScreen };
