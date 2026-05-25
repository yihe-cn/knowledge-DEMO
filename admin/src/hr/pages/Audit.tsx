import { useMemo, useState } from 'react';
import { I } from '../icons';
import { PageHeader } from '../components/primitives';
import { AUDIT_EVENTS, type AuditEvent } from '../data';

const ACTION_TONE: Record<AuditEvent['action'], { bg: string; fg: string }> = {
  '发布':     { bg: 'var(--st-approved-bg)', fg: 'var(--st-approved-fg)' },
  '审核通过': { bg: 'var(--st-approved-bg)', fg: 'var(--st-approved-fg)' },
  '修订':     { bg: 'var(--st-draft-bg)',    fg: 'var(--st-draft-fg)' },
  '上传':     { bg: 'var(--st-review-bg)',   fg: 'var(--st-review-fg)' },
  '驳回':     { bg: 'var(--st-expiring-bg)', fg: 'var(--st-expiring-fg)' },
  '回滚':     { bg: 'var(--st-expiring-bg)', fg: 'var(--st-expiring-fg)' },
  '解绑':     { bg: 'var(--st-archived-bg)', fg: 'var(--st-archived-fg)' },
  '归档':     { bg: 'var(--st-archived-bg)', fg: 'var(--st-archived-fg)' },
};

const ACTIONS: AuditEvent['action'][] = ['发布', '审核通过', '修订', '上传', '驳回', '回滚', '解绑', '归档'];

export default function Audit() {
  const [q, setQ] = useState('');
  const [active, setActive] = useState<Set<string>>(new Set());

  const toggle = (a: string) => {
    const n = new Set(active);
    n.has(a) ? n.delete(a) : n.add(a);
    setActive(n);
  };

  const events = useMemo(() => AUDIT_EVENTS.filter(e => {
    if (active.size > 0 && !active.has(e.action)) return false;
    if (!q) return true;
    return e.target.includes(q) || e.who.includes(q) || (e.targetId || '').includes(q);
  }), [q, active]);

  const stats = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of AUDIT_EVENTS) m[e.action] = (m[e.action] ?? 0) + 1;
    return m;
  }, []);

  return (
    <>
      <PageHeader
        crumbs={['审核运营', '变更与审计']}
        title="变更与审计"
        desc="所有发布 / 驳回 / 回滚 / 解绑的操作日志（mock 数据，待审计日志接口接入后替换）。可按时间、Owner、操作类型筛选。"
        actions={<>
          <button className="btn"><I.External /> 导出 CSV</button>
          <button className="btn"><I.External /> 导出 PDF</button>
        </>}
      />

      <div className="kpi-grid">
        <div className="kpi featured">
          <div className="label">本月操作总数</div>
          <div className="value mono">{AUDIT_EVENTS.length}</div>
          <div className="trend">覆盖 8 类操作 · 6 位操作人</div>
        </div>
        <div className="kpi">
          <div className="label">发布</div>
          <div className="value mono">{stats['发布'] ?? 0}</div>
          <div className="trend up">含系统自动推送</div>
        </div>
        <div className="kpi">
          <div className="label">驳回 / 回滚</div>
          <div className="value mono" style={{ color: 'var(--st-expiring-fg)' }}>{(stats['驳回'] ?? 0) + (stats['回滚'] ?? 0)}</div>
          <div className="trend down">需复盘</div>
        </div>
        <div className="kpi">
          <div className="label">文件上传</div>
          <div className="value mono">{stats['上传'] ?? 0}</div>
          <div className="trend">来自 HR / 法务 / 安全</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-search">
          <I.Search />
          <input placeholder="按条目 / 操作人 / ID 搜索…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>操作类型</span>
        {ACTIONS.map(a => (
          <span key={a} className={'chipsel' + (active.has(a) ? ' on' : '')} onClick={() => toggle(a)}>
            {active.has(a) ? <I.Check /> : null}
            {a}
          </span>
        ))}
        {active.size > 0 && (
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setActive(new Set())}>
            <I.X /> 清空筛选
          </button>
        )}
      </div>

      <div className="card flush">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: '18%' }}>时间</th>
              <th>操作人</th>
              <th>操作</th>
              <th style={{ width: '38%' }}>目标</th>
              <th>关联 ID</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>无匹配操作</td></tr>
            )}
            {events.map((e, i) => {
              const tone = ACTION_TONE[e.action];
              return (
                <tr key={i}>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{e.t}</td>
                  <td style={{ fontSize: 12 }}>
                    <div style={{ fontWeight: 500 }}>{e.who}</div>
                    <div className="mono" style={{ color: 'var(--muted-2)', fontSize: 11 }}>{e.role}</div>
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 20,
                      padding: '0 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                      fontFamily: 'var(--ff-mono)',
                      background: tone.bg, color: tone.fg,
                    }}>{e.action}</span>
                  </td>
                  <td style={{ fontSize: 13 }}>{e.target}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{e.targetId || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{e.note || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
