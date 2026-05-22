// screens-report.jsx — Evaluation report
const { useState, useEffect, useMemo, useRef, useCallback } = React;

function ReportScreen({ t, state, go }) {
  const { SCRIPT, KP_INDEX, CUSTOMER, KNOWLEDGE } = window.SIMUGO_DATA;
  const picks = state.picks || [];
  const viewedKp = useMemo(() => new Set(state.viewedKp || []), [state.viewedKp]);
  const citedKp = useMemo(() => {
    const s = new Set();
    picks.forEach(p => (p.cites || []).forEach(c => s.add(c)));
    return s;
  }, [picks]);
  const scenarioKp = useMemo(() => {
    const set = new Set();
    SCRIPT.forEach(turn => (turn.recommendedKp || []).forEach(id => set.add(id)));
    picks.forEach(p => (p.cites || []).forEach(id => set.add(id)));
    return Array.from(set);
  }, [picks]);

  // ─── Compute scores ──────────────────────────────────────
  const score = useMemo(() => computeScore(picks), [picks]);
  const dims = [
    { id: 'know', label: '产品知识准确性', weight: 35, value: score.know },
    { id: 'obj',  label: '异议处理',     weight: 30, value: score.obj  },
    { id: 'need', label: '需求挖掘',     weight: 20, value: score.need },
    { id: 'comm', label: '沟通表达',     weight: 15, value: score.comm },
  ];
  const total = Math.round(dims.reduce((acc, d) => acc + d.value * d.weight, 0) / 100);
  const grade = total >= 85 ? 'A' : total >= 75 ? 'B+' : total >= 65 ? 'B' : total >= 55 ? 'C' : 'D';
  const gradeColor = total >= 75 ? t.good : total >= 60 ? t.warn : t.bad;

  // ─── Find gaps (回指课程) ────────────────────────────────
  const gaps = useMemo(() => buildGaps(picks, SCRIPT), [picks]);

  // ─── Todos ────────────────────────────────────────────────
  const todos = useMemo(() => buildTodos(picks, gaps), [picks, gaps]);

  const [tab, setTab] = useState('overview');
  const [highlightKp, setHighlightKp] = useState(null);

  return (
    <div style={{ padding: '4px 18px 18px' }}>
      <TopBar t={t} title="评估报告" onBack={() => go('home')} right={
        <div style={{ ...neuRaised(t, 999), width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="refresh" size={16} color={t.text} />
        </div>
      } />

      {/* Score hero */}
      <Card t={t} style={{ padding: 22, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <ScoreDial t={t} value={total} color={gradeColor} grade={grade} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: t.textMute, letterSpacing: '0.08em', fontWeight: 600 }}>总评分</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.text, marginTop: 4 }}>
              {grade === 'A' ? '熟练 · 可以独立接待' : grade.startsWith('B') ? '基本掌握 · 仍需强化' : '需要回炉'}
            </div>
            <div style={{ fontSize: 12, color: t.textSoft, marginTop: 6, lineHeight: 1.55 }}>
              {grade === 'A' ? '产品力扎实，对话节奏清晰。建议直接进入下一场景。' :
               grade.startsWith('B') ? `${gaps.length} 个能力缺口需要回到课程强化后再练。` :
               '多个核心知识点未在对话中调用，建议回到课程模块重新学习。'}
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ ...neuInset(t, 999, 0.6), padding: 4, display: 'flex', gap: 4, marginBottom: 16 }}>
        {[
          { id: 'overview', label: '能力雷达' },
          { id: 'gaps',     label: '回指课程' },
          { id: 'todos',    label: '改进待办' },
          { id: 'replay',   label: '对话回放' },
        ].map(x => (
          <div key={x.id} onClick={() => setTab(x.id)} style={{
            flex: 1, textAlign: 'center', padding: '8px 6px', borderRadius: 999, cursor: 'pointer',
            fontSize: 11.5, fontWeight: 600,
            color: tab === x.id ? '#fff' : t.textSoft,
            background: tab === x.id ? t.accent : 'transparent',
            boxShadow: tab === x.id ? `2px 2px 4px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.18)` : 'none',
            transition: 'all .2s',
          }}>{x.label}</div>
        ))}
      </div>

      {/* Panels */}
      {tab === 'overview' && (
        <OverviewPanel t={t} dims={dims} total={total}
          scenarioKp={scenarioKp} citedKp={citedKp} viewedKp={viewedKp}
          onOpenKp={(id) => setHighlightKp(id)} />
      )}
      {tab === 'gaps' && <GapsPanel t={t} gaps={gaps} onJumpToCourse={(kpId) => { setHighlightKp(kpId); go('learn', { highlight: kpId }); }} />}
      {tab === 'todos' && <TodosPanel t={t} todos={todos} />}
      {tab === 'replay' && <ReplayPanel t={t} picks={picks} />}

      {/* Bottom CTA */}
      <BottomCTA t={t}>
        <div style={{ display: 'flex', gap: 10 }}>
          <PillButton t={t} onClick={() => go('home')} style={{ flex: 1 }}>返回首页</PillButton>
          <PillButton t={t} primary onClick={() => go('practice')} style={{ flex: 1.3 }}>再来一次 →</PillButton>
        </div>
      </BottomCTA>

      {/* KP detail modal — opened from coverage card or gap card */}
      {highlightKp && (
        <KpDetailModal
          t={t} kpId={highlightKp}
          cited={citedKp.has(highlightKp)}
          onClose={() => setHighlightKp(null)}
        />
      )}
    </div>
  );
}

// ─── Score computation ────────────────────────────────────
function computeScore(picks) {
  // Each pick has skill + quality. Map quality to base score per dim.
  const skillMap = {
    '产品知识': 'know', '异议处理': 'obj', '需求挖掘': 'need', '沟通表达': 'comm', '推进成交': 'comm',
  };
  const base = { know: [], obj: [], need: [], comm: [] };
  picks.forEach(p => {
    const s = { good: 95, mid: 70, bad: 35 }[p.quality];
    const dim = skillMap[p.skill] || 'comm';
    base[dim].push(s);
    // Cite-based bonus for knowledge dim
    if (p.cites && p.cites.length > 0) {
      base.know.push({ good: 92, mid: 75, bad: 50 }[p.quality]);
    }
  });
  const avg = (arr, def = 60) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : def;
  return {
    know: Math.round(avg(base.know)),
    obj:  Math.round(avg(base.obj)),
    need: Math.round(avg(base.need)),
    comm: Math.round(avg(base.comm)),
  };
}

function buildGaps(picks, SCRIPT) {
  // For each non-good pick, identify what kp should have been used
  const gaps = [];
  picks.forEach((p, i) => {
    if (p.quality === 'good') return;
    const turn = SCRIPT[i];
    const goodOpt = turn.options.find(o => o.quality === 'good');
    const shouldCite = goodOpt?.cites || [];
    if (shouldCite.length === 0 && p.quality !== 'bad') return;
    gaps.push({
      turnId: turn.id,
      turnIndex: i,
      customer: turn.customer,
      quality: p.quality,
      missedKp: shouldCite,
      didUseKp: p.cites || [],
      skill: p.skill,
      feedback: p.feedback,
    });
  });
  return gaps;
}

function buildTodos(picks, gaps) {
  const out = [];
  gaps.forEach(g => {
    if (g.missedKp.length > 0) {
      g.missedKp.forEach(kpId => {
        const ref = window.SIMUGO_DATA.KP_INDEX[kpId];
        if (!ref) return;
        out.push({
          priority: g.quality === 'bad' ? 'high' : 'mid',
          title: `重学《${ref.module.title}》中的「${ref.point.title}」`,
          context: `在客户说"${truncate(g.customer, 22)}"时未引用`,
          kpId,
        });
      });
    } else {
      out.push({
        priority: 'mid',
        title: `强化 · ${g.skill}`,
        context: g.feedback,
        kpId: null,
      });
    }
  });
  if (out.length === 0) {
    out.push({ priority: 'low', title: '保持节奏', context: '本次演练表现优秀，可直接进入下一场景。', kpId: null });
  }
  return out;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

// ─── Score dial ───────────────────────────────────────────
function ScoreDial({ t, value, color, grade }) {
  const r = 38, c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div style={{ width: 100, height: 100, position: 'relative', ...neuRaised(t, 999, 1.2), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="100" height="100" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} stroke={t.line} strokeWidth="6" fill="none" />
        <circle cx="50" cy="50" r={r} stroke={color} strokeWidth="6" fill="none"
          strokeDasharray={c} strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.22,.61,.36,1)', filter: `drop-shadow(0 0 4px ${color}80)` }}
        />
      </svg>
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: t.text, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: color, fontWeight: 700, marginTop: 2 }}>{grade}</div>
      </div>
    </div>
  );
}

// ─── Radar chart ──────────────────────────────────────────
function OverviewPanel({ t, dims, total, scenarioKp, citedKp, viewedKp, onOpenKp }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card t={t} style={{ padding: 18 }}>
        <RadarChart t={t} dims={dims} />
      </Card>
      <KnowledgeCoverageCard t={t}
        scenarioKp={scenarioKp} citedKp={citedKp} viewedKp={viewedKp}
        onOpenKp={onOpenKp} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dims.map(d => (
          <Card key={d.id} t={t} style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{d.label}</div>
                <div style={{ fontSize: 11, color: t.textMute, marginTop: 2 }}>权重 {d.weight}%</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: d.value >= 75 ? t.good : d.value >= 60 ? t.warn : t.bad, fontVariantNumeric: 'tabular-nums' }}>{d.value}</div>
            </div>
            <div style={{ height: 5, ...neuInset(t, 999, 0.4), position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${d.value}%`,
                background: d.value >= 75 ? t.good : d.value >= 60 ? t.warn : t.bad,
                transition: 'width .6s',
              }} />
            </div>
            <div style={{ fontSize: 12, color: t.textSoft, marginTop: 10, lineHeight: 1.5 }}>{dimensionComment(d)}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function dimensionComment(d) {
  if (d.id === 'know') return d.value >= 75 ? '参数引用具体、可信。' : d.value >= 60 ? '提到了参数但未充分展开。' : '多处应用知识点的机会未被把握。';
  if (d.id === 'obj')  return d.value >= 75 ? '面对顾虑能先共情、再用事实回应。' : d.value >= 60 ? '回应客户顾虑时事实依据不够。' : '在关键顾虑环节缺乏事实支撑。';
  if (d.id === 'need') return d.value >= 75 ? '介绍产品前先了解客户场景。' : '可在更多环节先反问客户用车习惯。';
  return d.value >= 75 ? '表达专业、节奏顺畅。' : '节奏有些急，可放慢推进。';
}

function RadarChart({ t, dims }) {
  const cx = 130, cy = 110, R = 80;
  const n = dims.length;
  const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i, v) => [cx + Math.cos(angle(i)) * R * (v / 100), cy + Math.sin(angle(i)) * R * (v / 100)];
  const rings = [25, 50, 75, 100];

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width="260" height="240" viewBox="0 0 260 240">
        <defs>
          <radialGradient id="radFill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={t.accent} stopOpacity="0.5" />
            <stop offset="100%" stopColor={t.accentSoft} stopOpacity="0.15" />
          </radialGradient>
        </defs>
        {/* Rings */}
        {rings.map((r, i) => (
          <polygon key={i}
            points={Array.from({ length: n }, (_, j) => pt(j, r).join(',')).join(' ')}
            fill="none" stroke={t.line} strokeWidth="1"
          />
        ))}
        {/* Spokes */}
        {dims.map((_, i) => <line key={i} x1={cx} y1={cy} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke={t.line} strokeWidth="1" />)}
        {/* Data */}
        <polygon
          points={dims.map((d, i) => pt(i, d.value).join(',')).join(' ')}
          fill="url(#radFill)" stroke={t.accent} strokeWidth="2"
          style={{ filter: `drop-shadow(0 2px 6px ${t.accent}55)` }}
        />
        {dims.map((d, i) => {
          const [x, y] = pt(i, d.value);
          return <circle key={i} cx={x} cy={y} r="3.5" fill={t.accent} stroke="#fff" strokeWidth="1.5" />;
        })}
        {/* Labels */}
        {dims.map((d, i) => {
          const [x, y] = pt(i, 118);
          const a = angle(i);
          const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
          return (
            <g key={i}>
              <text x={x} y={y} textAnchor={anchor} fontSize="11" fontWeight="600" fill={t.text} dy="3">{d.label}</text>
              <text x={x} y={y + 13} textAnchor={anchor} fontSize="10" fill={t.textMute}>{d.value} · {d.weight}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Gaps panel · 回指课程 ─────────────────────────────────
function GapsPanel({ t, gaps, onJumpToCourse }) {
  if (gaps.length === 0) {
    return <Card t={t} style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 32 }}>🎯</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginTop: 8 }}>没有能力缺口</div>
      <div style={{ fontSize: 12, color: t.textSoft, marginTop: 4 }}>全程都用对了知识点。</div>
    </Card>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: t.textSoft, padding: '0 4px 4px', lineHeight: 1.5 }}>
        每个失分点都标注了未引用的<b style={{ color: t.accent }}>课程知识点</b>，点击直接跳回课程模块复习。
      </div>
      {gaps.map((g, i) => (
        <Card key={i} t={t} style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 999,
              background: g.quality === 'bad' ? t.bad : t.warn,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>{i + 1}</div>
            <div style={{ fontSize: 12, color: t.textMute }}>第 {g.turnIndex + 1} 轮 · {g.skill}</div>
          </div>
          <div style={{ ...neuInset(t, 12, 0.5), padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: t.textMute, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>客户原话</div>
            <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>"{g.customer}"</div>
          </div>
          <div style={{ fontSize: 12, color: t.textSoft, lineHeight: 1.55, marginBottom: 10 }}>{g.feedback}</div>
          {g.missedKp.map(kpId => {
            const ref = window.SIMUGO_DATA.KP_INDEX[kpId];
            if (!ref) return null;
            return (
              <div key={kpId} onClick={() => onJumpToCourse(kpId)} style={{
                marginTop: 6, padding: '10px 12px', borderRadius: 12,
                background: `linear-gradient(135deg, ${t.accent}18, ${t.accentSoft}14)`,
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                border: `1px solid ${t.accent}30`,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, background: t.accent, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  fontSize: 14, fontWeight: 700,
                }}>{ref.module.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: t.accent, fontWeight: 700, letterSpacing: '0.08em' }}>未引用 · 回指课程</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginTop: 2 }}>{ref.module.title} › {ref.point.title}</div>
                </div>
                <Icon name="arrow" size={16} color={t.accent} />
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

// ─── Todos panel ───────────────────────────────────────────
function TodosPanel({ t, todos }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: t.textSoft, padding: '0 4px 4px', lineHeight: 1.5 }}>
        按优先级排列。后续版本中，未完成的待办将<b style={{ color: t.accent }}>跨会话流转</b>，带入下一次演练重点检验。
      </div>
      {todos.map((td, i) => {
        const pr = td.priority;
        const prColor = pr === 'high' ? t.bad : pr === 'mid' ? t.warn : t.good;
        const prLabel = pr === 'high' ? '高' : pr === 'mid' ? '中' : '低';
        return (
          <Card key={i} t={t} style={{ padding: 14, display: 'flex', gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: `${prColor}20`, color: prColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 800, flexShrink: 0,
            }}>{prLabel}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: t.text, lineHeight: 1.4 }}>{td.title}</div>
              <div style={{ fontSize: 11.5, color: t.textSoft, marginTop: 4, lineHeight: 1.5 }}>{td.context}</div>
            </div>
            <div style={{
              width: 22, height: 22, borderRadius: 999,
              border: `1.5px solid ${t.textMute}`,
              flexShrink: 0, marginTop: 4,
            }} />
          </Card>
        );
      })}
    </div>
  );
}

// ─── Replay panel ──────────────────────────────────────────
function ReplayPanel({ t, picks }) {
  const { SCRIPT } = window.SIMUGO_DATA;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {picks.map((p, i) => {
        const turn = SCRIPT[i];
        const opt = turn.options.find(o => o.id === p.optionId);
        const qc = p.quality === 'good' ? t.good : p.quality === 'bad' ? t.bad : t.warn;
        const qLabel = p.quality === 'good' ? '正确' : p.quality === 'bad' ? '失误' : '可改进';
        return (
          <Card key={i} t={t} style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: t.textMute, fontWeight: 600 }}>第 {i + 1} 轮 · {p.skill}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: qc, padding: '2px 8px', borderRadius: 999, background: `${qc}20` }}>{qLabel}</span>
            </div>
            <div style={{ fontSize: 12, color: t.textSoft, marginBottom: 6, lineHeight: 1.5 }}>客户："{turn.customer}"</div>
            <div style={{ ...neuInset(t, 12, 0.5), padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: t.textMute, fontWeight: 600, marginBottom: 4 }}>你的回应</div>
              <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>{opt?.text}</div>
            </div>
            <div style={{ fontSize: 11.5, color: t.textSoft, lineHeight: 1.5, padding: '0 4px' }}>
              <b style={{ color: qc }}>教练点评：</b>{p.feedback}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

Object.assign(window, { ReportScreen });

// ─── Knowledge coverage card — appears in overview ────────
function KnowledgeCoverageCard({ t, scenarioKp, citedKp, viewedKp, onOpenKp }) {
  const { KP_INDEX } = window.SIMUGO_DATA;
  if (!scenarioKp || scenarioKp.length === 0) return null;

  // Bucket each KP into a status
  const rows = scenarioKp.map(id => {
    const ref = KP_INDEX[id];
    if (!ref) return null;
    let status = 'missed';
    if (citedKp.has(id)) status = 'cited';
    else if (viewedKp.has(id)) status = 'viewed';
    return { id, ref, status };
  }).filter(Boolean);

  // Sort: cited → viewed → missed; within group, core first
  const order = { cited: 0, viewed: 1, missed: 2 };
  rows.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    const ac = a.ref.point.tier === 'core' ? 0 : 1;
    const bc = b.ref.point.tier === 'core' ? 0 : 1;
    return ac - bc;
  });

  const counts = {
    total: rows.length,
    cited: rows.filter(r => r.status === 'cited').length,
    viewed: rows.filter(r => r.status === 'viewed').length,
    missed: rows.filter(r => r.status === 'missed').length,
  };
  const pct = Math.round((counts.cited / counts.total) * 100);

  return (
    <Card t={t} style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9,
          background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)`,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: `1.5px 1.5px 3px ${t.sDark}, inset 0 1px 0 rgba(255,255,255,0.2)`,
        }}>
          <Icon name="book" size={15} color="#fff" stroke={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text, lineHeight: 1.2 }}>知识弹药覆盖</div>
          <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 2 }}>本场对话覆盖了 {counts.total} 个知识点</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: pct >= 70 ? t.good : pct >= 40 ? t.warn : t.bad, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {pct}<span style={{ fontSize: 11, marginLeft: 1 }}>%</span>
          </div>
          <div style={{ fontSize: 9.5, color: t.textMute, fontWeight: 600, letterSpacing: '0.06em', marginTop: 2 }}>引用率</div>
        </div>
      </div>

      {/* Three-segment count bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[
          { id: 'cited',  label: '引用', n: counts.cited,  color: t.good },
          { id: 'viewed', label: '查阅', n: counts.viewed, color: t.warn },
          { id: 'missed', label: '错过', n: counts.missed, color: t.bad  },
        ].map(s => (
          <div key={s.id} style={{
            flex: Math.max(s.n, 0.3),
            padding: '8px 10px',
            borderRadius: 10,
            background: `${s.color}14`,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            transition: 'flex .5s cubic-bezier(.22,.61,.36,1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{s.n}</span>
            </div>
            <span style={{ fontSize: 10, color: t.textSoft, fontWeight: 600, marginTop: 3, letterSpacing: '0.04em' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* KP rows */}
      <div style={{
        ...neuInset(t, 12, 0.4),
        padding: 8,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {rows.map(r => <KpCoverageRow key={r.id} t={t} row={r} onOpen={onOpenKp} />)}
      </div>

      <div style={{
        fontSize: 11, color: t.textMute, lineHeight: 1.55,
        marginTop: 12, padding: '0 2px',
      }}>
        点击任一条目查看完整知识卡 · 错过的知识点会在下次同类场景中优先推荐。
      </div>
    </Card>
  );
}

function KpCoverageRow({ t, row, onOpen }) {
  const { id, ref, status } = row;
  const { point: p, module: m } = ref;
  const isCore = p.tier === 'core';

  const statusConf = {
    cited:  { icon: '✓', color: t.good,     label: '引用' },
    viewed: { icon: '◔', color: t.warn,     label: '已查阅' },
    missed: { icon: '○', color: t.textMute, label: '错过' },
  }[status];

  return (
    <div onClick={() => onOpen(id)} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 9,
      cursor: 'pointer',
      transition: 'background .15s',
      background: 'transparent',
    }}
    onMouseEnter={e => e.currentTarget.style.background = `${t.surface2}90`}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {/* Status dot */}
      <div style={{
        width: 20, height: 20, borderRadius: 999,
        background: `${statusConf.color}25`,
        color: statusConf.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, flexShrink: 0,
      }}>{statusConf.icon}</div>

      {/* Module + KP */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, flexShrink: 0 }}>{m.icon}</span>
        <span style={{
          fontSize: 13, fontWeight: 600, color: t.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{p.title}</span>
        {isCore && (
          <span style={{
            fontSize: 8.5, fontWeight: 700, color: t.accentSoft,
            padding: '1px 5px', borderRadius: 4,
            background: `${t.accentSoft}18`, letterSpacing: '0.06em',
            flexShrink: 0,
          }}>重点</span>
        )}
      </div>

      {/* Status label + chevron */}
      <span style={{
        fontSize: 10.5, color: statusConf.color, fontWeight: 600, flexShrink: 0,
      }}>{statusConf.label}</span>
      <Icon name="arrow" size={11} color={t.textMute} />
    </div>
  );
}
