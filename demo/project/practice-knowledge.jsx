// practice-knowledge.jsx — knowledge "ammo" UI for the practice screen
// ─────────────────────────────────────────────────────────────────────────
// Surfaces the knowledge base inside the conversation in three places:
//
//  1. <AmmoStrip>            Contextual ammo cards rendered under the
//                            latest customer bubble. 2-3 recommended KPs,
//                            tap → full detail modal.
//
//  2. <KnowledgeLibrarySheet> Full library bottom sheet, triggered from
//                            the 📚 button on the input bar. Modules →
//                            expandable points.
//
//  3. <KpDetailModal>        Shared full-detail view used by both above.
//                            Shows spec / customerVoice / sources /
//                            appliesTo / rebuttals / sales tip.
//
//  4. <MissedHint>           Tiny grey nudge under a student bubble when
//                            they missed the obvious recommended KP.

const { useState: ukState, useMemo: ukMemo, useEffect: ukEffect } = React;

// ─── Source type → mini badge color ────────────────────────────
function sourceBadgeColor(t, type) {
  if (type === '官方') return t.accent;
  if (type === '实测') return t.good;
  return t.accentSoft; // 内部
}

// ─── KP "ammo" card — compact, used in strip + library list ────
// `dense=true` is the strip variant (fixed width, horizontal scroll).
function KpAmmoCard({ t, kpId, dense = false, viewed = false, cited = false, onOpen }) {
  const ref = window.SIMUGO_DATA.KP_INDEX[kpId];
  if (!ref) return null;
  const { point: p, module: m } = ref;
  const isCore = p.tier === 'core';

  return (
    <div
      onClick={() => onOpen(kpId)}
      style={{
        ...neuFlat(t, 14),
        padding: '10px 12px',
        cursor: 'pointer',
        flexShrink: 0,
        width: dense ? 218 : 'auto',
        position: 'relative',
        transition: 'transform .15s ease, box-shadow .15s ease',
        background: cited
          ? `linear-gradient(135deg, ${t.good}10, ${t.surface})`
          : t.surface,
      }}
    >
      {/* Header row: module icon + tier badge + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 6,
          background: t.accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>{m.icon}</div>
        <span style={{ fontSize: 9.5, color: t.textMute, fontWeight: 600, letterSpacing: '0.04em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.title}
        </span>
        {isCore && (
          <span style={{
            fontSize: 8.5, fontWeight: 700, color: t.accentSoft,
            padding: '1px 5px', borderRadius: 4,
            background: `${t.accentSoft}18`, letterSpacing: '0.06em',
          }}>重点</span>
        )}
        {cited && (
          <span style={{ display: 'inline-flex', color: t.good }}>
            <Icon name="check" size={11} color={t.good} stroke={2.4} />
          </span>
        )}
      </div>

      {/* KP title */}
      <div style={{
        fontSize: 13, fontWeight: 700, color: t.text,
        marginBottom: 5, lineHeight: 1.3,
      }}>{p.title}</div>

      {/* Customer voice translation */}
      <div style={{
        fontSize: 11, color: t.textSoft, lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: dense ? 2 : 3, WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        <span style={{ color: t.accent, fontWeight: 700, marginRight: 4 }}>"</span>
        {p.customerVoice}
        <span style={{ color: t.accent, fontWeight: 700, marginLeft: 2 }}>"</span>
      </div>

      {viewed && !cited && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          width: 6, height: 6, borderRadius: 999,
          background: t.textMute, opacity: 0.5,
        }} title="已查阅" />
      )}
    </div>
  );
}

// ─── 1. Ammo strip — horizontal scroll under latest customer ───
function AmmoStrip({ t, kpIds, viewedKp, citedKp, onOpenKp }) {
  if (!kpIds || kpIds.length === 0) return null;
  return (
    <div style={{
      alignSelf: 'stretch',
      marginTop: -2, marginBottom: 4,
      animation: 'ammoFadeIn .35s ease',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 6, padding: '0 2px',
      }}>
        <Icon name="bolt" size={11} color={t.accentSoft} stroke={2} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: t.accentSoft,
          letterSpacing: '0.1em',
        }}>推荐弹药</span>
        <span style={{ fontSize: 10, color: t.textMute }}>· {kpIds.length} 条相关知识点</span>
      </div>
      <div style={{
        display: 'flex', gap: 8,
        overflowX: 'auto', overflowY: 'hidden',
        margin: '0 -16px', padding: '2px 16px 4px',
        scrollSnapType: 'x mandatory',
      }}>
        {kpIds.map(id => (
          <div key={id} style={{ scrollSnapAlign: 'start' }}>
            <KpAmmoCard
              t={t} kpId={id} dense
              viewed={viewedKp?.has(id)}
              cited={citedKp?.has(id)}
              onOpen={onOpenKp}
            />
          </div>
        ))}
      </div>
      <style>{`@keyframes ammoFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

// ─── 2. Knowledge library bottom sheet ─────────────────────────
function KnowledgeLibrarySheet({ t, onClose, onOpenKp, viewedKp, citedKp }) {
  const { KNOWLEDGE } = window.SIMUGO_DATA;
  const [query, setQuery] = ukState('');
  const [filter, setFilter] = ukState('all'); // all | core | cited

  const filtered = ukMemo(() => {
    return KNOWLEDGE.map(m => ({
      ...m,
      points: m.points.filter(p => {
        if (filter === 'core' && p.tier !== 'core') return false;
        if (filter === 'cited' && !citedKp.has(p.id)) return false;
        if (query) {
          const q = query.toLowerCase();
          return (p.title + p.spec + p.customerVoice).toLowerCase().includes(q);
        }
        return true;
      }),
    })).filter(m => m.points.length > 0);
  }, [query, filter, citedKp]);

  const totalKp = useMemo(() => KNOWLEDGE.reduce((a, m) => a + m.points.length, 0), []);
  const citedCount = citedKp.size;

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.4)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 60, display: 'flex', alignItems: 'flex-end',
      animation: 'sheetFadeIn .2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bg, width: '100%',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        maxHeight: '88%',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 -10px 30px rgba(0,0,0,0.2)`,
        animation: 'sheetSlideUp .28s cubic-bezier(.22,.61,.36,1)',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 6px' }}>
          <div style={{ width: 42, height: 5, borderRadius: 999, background: t.textMute, opacity: 0.4 }} />
        </div>

        {/* Header */}
        <div style={{ padding: '8px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `2px 2px 5px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
            }}>
              <Icon name="book" size={18} color="#fff" stroke={1.8} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>知识弹药库</div>
              <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 1 }}>
                {totalKp} 个知识点 · 本场已引用 <b style={{ color: t.good }}>{citedCount}</b>
              </div>
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

          {/* Search */}
          <div style={{
            ...neuInset(t, 999, 0.6), padding: '6px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Icon name="target" size={13} color={t.textMute} stroke={1.8} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索知识点、规格、客户感知…"
              style={{
                flex: 1, border: 0, background: 'transparent', outline: 'none',
                fontSize: 12.5, color: t.text, fontFamily: 'inherit',
                padding: '4px 0', minWidth: 0,
              }}
            />
            {query && (
              <span onClick={() => setQuery('')} style={{ cursor: 'pointer', display: 'inline-flex' }}>
                <Icon name="close" size={13} color={t.textMute} />
              </span>
            )}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {[
              { id: 'all',   label: `全部 ${totalKp}` },
              { id: 'core',  label: '重点 5' },
              { id: 'cited', label: `已引用 ${citedCount}` },
            ].map(f => (
              <div key={f.id} onClick={() => setFilter(f.id)} style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 999,
                fontWeight: 600, cursor: 'pointer',
                background: filter === f.id ? t.accent : 'transparent',
                color: filter === f.id ? '#fff' : t.textSoft,
                boxShadow: filter === f.id
                  ? `2px 2px 4px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.18)`
                  : `inset 1.5px 1.5px 3px ${t.sDark}, inset -1.5px -1.5px 3px ${t.sLight}`,
                transition: 'all .2s',
              }}>{f.label}</div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '0 20px 24px',
        }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: t.textMute, fontSize: 12 }}>
              没有匹配的知识点
            </div>
          ) : filtered.map(m => (
            <div key={m.id} style={{ marginBottom: 18 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                padding: '0 2px',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 7,
                  background: t.accent, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, flexShrink: 0,
                  boxShadow: `1px 1px 2px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
                }}>{m.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{m.title}</div>
                <span style={{ fontSize: 10, color: t.textMute }}>{m.points.length} 条</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.points.map(p => (
                  <KpAmmoCard
                    key={p.id} t={t} kpId={p.id}
                    viewed={viewedKp.has(p.id)}
                    cited={citedKp.has(p.id)}
                    onOpen={onOpenKp}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 3. KP detail modal — full content (shared by strip + library) ──
function KpDetailModal({ t, kpId, cited, onClose }) {
  const ref = window.SIMUGO_DATA.KP_INDEX[kpId];
  if (!ref) return null;
  const { point: p, module: m } = ref;
  const isCore = p.tier === 'core';

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 70, display: 'flex', alignItems: 'flex-end',
      animation: 'sheetFadeIn .2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bg, width: '100%',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        maxHeight: '90%',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 -10px 30px rgba(0,0,0,0.25)`,
        animation: 'sheetSlideUp .28s cubic-bezier(.22,.61,.36,1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
          <div style={{ width: 42, height: 5, borderRadius: 999, background: t.textMute, opacity: 0.4 }} />
        </div>

        {/* Header */}
        <div style={{ padding: '8px 22px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 9,
              background: t.accent, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, flexShrink: 0,
              boxShadow: `1.5px 1.5px 3px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
            }}>{m.icon}</div>
            <span style={{ fontSize: 11, color: t.textMute, fontWeight: 600 }}>{m.title}</span>
            <div style={{ flex: 1 }} />
            {isCore && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: t.accentSoft,
                padding: '3px 9px', borderRadius: 999,
                background: `${t.accentSoft}20`, letterSpacing: '0.06em',
              }}>重点 · 深度</span>
            )}
            {cited && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: t.good,
                padding: '3px 9px', borderRadius: 999,
                background: `${t.good}20`, letterSpacing: '0.04em',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Icon name="check" size={11} color={t.good} stroke={2.4} /> 已引用
              </span>
            )}
            <button onClick={onClose} style={{
              width: 30, height: 30, border: 0, borderRadius: 999,
              background: t.surface, cursor: 'pointer',
              boxShadow: `2px 2px 4px ${t.sDark}, -2px -2px 4px ${t.sLight}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4,
            }}>
              <Icon name="close" size={14} color={t.textSoft} />
            </button>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
            {p.title}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 28px' }}>
          {/* Spec */}
          <KpBlock t={t} icon="◉" iconColor={t.text} label="规格">
            <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.65 }}>{p.spec}</div>
          </KpBlock>

          {/* Customer voice */}
          <KpBlock t={t} icon="✦" iconColor={t.accent} label="客户能感知到的">
            <div style={{
              ...neuInset(t, 14, 0.5),
              padding: '12px 14px',
              fontSize: 14, color: t.text, lineHeight: 1.6,
              fontStyle: 'italic',
              borderLeft: `3px solid ${t.accent}`,
            }}>
              "{p.customerVoice}"
            </div>
          </KpBlock>

          {/* Sources */}
          {p.sources && p.sources.length > 0 && (
            <KpBlock t={t} icon="❖" iconColor={t.textSoft} label="数据信源">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.sources.map((s, i) => {
                  const c = sourceBadgeColor(t, s.type);
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 11px',
                      ...neuFlat(t, 10),
                    }}>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, color: c,
                        padding: '2px 7px', borderRadius: 4,
                        background: `${c}20`, letterSpacing: '0.04em',
                        flexShrink: 0,
                      }}>{s.type}</span>
                      <span style={{ fontSize: 11.5, color: t.textSoft, lineHeight: 1.4 }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </KpBlock>
          )}

          {/* AppliesTo + NotApplicable (core only) */}
          {isCore && p.appliesTo && (
            <KpBlock t={t} icon="◎" iconColor={t.good} label="适用顾虑">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {p.appliesTo.map((c, i) => (
                  <span key={i} style={{
                    fontSize: 11.5, padding: '4px 10px', borderRadius: 999,
                    background: `${t.good}18`, color: t.good, fontWeight: 600,
                  }}>{c}</span>
                ))}
              </div>
              {p.notApplicable && p.notApplicable.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: t.textMute, fontWeight: 600, marginTop: 12, marginBottom: 6, letterSpacing: '0.06em' }}>
                    不必硬讲
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {p.notApplicable.map((c, i) => (
                      <span key={i} style={{
                        fontSize: 11.5, padding: '4px 10px', borderRadius: 999,
                        background: `${t.textMute}18`, color: t.textMute, fontWeight: 600,
                        textDecoration: 'line-through', textDecorationColor: `${t.textMute}80`,
                      }}>{c}</span>
                    ))}
                  </div>
                </>
              )}
            </KpBlock>
          )}

          {/* Rebuttals — 反向用法 */}
          {p.rebuttals && p.rebuttals.length > 0 && (
            <KpBlock t={t} icon="⚐" iconColor={t.warn} label="客户常见反驳 · 应对思路">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {p.rebuttals.map((r, i) => (
                  <div key={i} style={{ ...neuFlat(t, 14), padding: '12px 14px' }}>
                    <div style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      marginBottom: 8, paddingBottom: 8,
                      borderBottom: `1px dashed ${t.line}`,
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: t.warn,
                        padding: '2px 6px', borderRadius: 4,
                        background: `${t.warn}20`, flexShrink: 0, marginTop: 1,
                      }}>客户</div>
                      <div style={{ fontSize: 13, color: t.text, lineHeight: 1.5, flex: 1 }}>
                        "{r.q}"
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: t.accent,
                        padding: '2px 6px', borderRadius: 4,
                        background: `${t.accent}20`, flexShrink: 0, marginTop: 1,
                      }}>思路</div>
                      <div style={{ fontSize: 12.5, color: t.textSoft, lineHeight: 1.55, flex: 1 }}>
                        {r.approach}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </KpBlock>
          )}

          {/* Sales coaching tip */}
          {p.sales && (
            <KpBlock t={t} icon="✎" iconColor={t.accentSoft} label="销售技巧">
              <div style={{
                fontSize: 12.5, color: t.textSoft, lineHeight: 1.6,
                padding: '10px 12px',
                background: `${t.accentSoft}10`,
                borderRadius: 12,
                borderLeft: `2.5px solid ${t.accentSoft}`,
              }}>{p.sales}</div>
            </KpBlock>
          )}

          <div style={{
            fontSize: 10.5, color: t.textMute, textAlign: 'center',
            marginTop: 18, lineHeight: 1.5,
          }}>
            知识点不会自动填入对话——靠记忆和理解，才是真正在练。
          </div>
        </div>
      </div>
    </div>
  );
}

function KpBlock({ t, icon, iconColor, label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, padding: '0 2px' }}>
        <span style={{ fontSize: 12, color: iconColor, fontWeight: 700, lineHeight: 1 }}>{icon}</span>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: t.textSoft,
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

// ─── 4. Missed-KP soft hint under student bubble ────────────────
function MissedHint({ t, kpIds, onOpenKp }) {
  if (!kpIds || kpIds.length === 0) return null;
  return (
    <div style={{
      alignSelf: 'flex-end',
      maxWidth: '82%',
      marginTop: 4, marginBottom: 2,
      animation: 'hintFadeIn .35s ease .2s both',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        padding: '6px 10px',
        background: `${t.warn}10`,
        borderRadius: 10,
        border: `1px dashed ${t.warn}50`,
      }}>
        <span style={{ fontSize: 11, color: t.warn, lineHeight: 1.4, flexShrink: 0, marginTop: 1 }}>💡</span>
        <div style={{ fontSize: 11, color: t.textSoft, lineHeight: 1.5, flex: 1 }}>
          这里其实可以引用{' '}
          {kpIds.slice(0, 2).map((id, i) => {
            const ref = window.SIMUGO_DATA.KP_INDEX[id];
            if (!ref) return null;
            return (
              <span key={id}>
                {i > 0 && <span style={{ color: t.textMute }}> · </span>}
                <span
                  onClick={() => onOpenKp(id)}
                  style={{ color: t.warn, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                >{ref.point.title}</span>
              </span>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes hintFadeIn{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

Object.assign(window, {
  KpAmmoCard, AmmoStrip, KnowledgeLibrarySheet, KpDetailModal, MissedHint,
});
