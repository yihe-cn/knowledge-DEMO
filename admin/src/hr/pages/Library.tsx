import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { I } from '../icons';
import { PageHeader, Pill } from '../components/primitives';
import { useItems, formatItemId, formatVersion, type HrItem } from '../api';

const STATUS_TABS: Array<{ key: string; label: (n: number) => string; filter: (i: HrItem) => boolean }> = [
  { key: 'all',      label: n => '全部 ' + n,    filter: () => true },
  { key: 'draft',    label: n => '待办 ' + n,    filter: i => i.status === 'draft' },
  { key: 'approved', label: n => '已发布 ' + n,  filter: i => i.status === 'approved' },
  { key: 'archived', label: n => '已归档 ' + n,  filter: i => i.status === 'archived' },
];

export default function Library() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const all = useItems({ limit: 500 });
  const items = all.data || [];

  const counts: Record<string, number> = {};
  for (const tab of STATUS_TABS) counts[tab.key] = items.filter(tab.filter).length;

  const tabFn = STATUS_TABS.find(t => t.key === statusTab)?.filter || (() => true);
  const filtered = items.filter(it => {
    if (!tabFn(it)) return false;
    if (q && !(it.name?.includes(q) || it.definition?.includes(q) || String(it.id).includes(q))) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        crumbs={['知识维护', '知识条目']}
        title="知识条目"
        desc="所有面向员工的知识原子。每条条目都有明确的分类与状态，是 HRBot 与员工自助门户的唯一事实来源。"
        actions={<>
          <button className="btn"><I.Sort /> 排序</button>
          <button className="btn"><I.External /> 导出</button>
          <button className="btn primary"><I.Plus /> 新建条目</button>
        </>}
      />

      <div className="filter-bar">
        <div className="filter-search">
          <I.Search />
          <input placeholder="按标题、ID、定义搜索…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="kbd mono" style={{ fontSize: 10, color: 'var(--muted-2)' }}>⌘ F</span>
        </div>

        <div className="seg">
          {STATUS_TABS.map(t => (
            <button key={t.key} className={statusTab === t.key ? 'on' : ''} onClick={() => setStatusTab(t.key)}>
              {t.label(counts[t.key])}
            </button>
          ))}
        </div>
      </div>

      <div className="card flush">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: '52%' }}>条目</th>
              <th>分类</th>
              <th>状态</th>
              <th>版本</th>
            </tr>
          </thead>
          <tbody>
            {all.isLoading && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>加载中…</td></tr>
            )}
            {!all.isLoading && filtered.map(it => (
              <tr key={it.id} onClick={() => nav(`/hr/items/${it.id}`)}>
                <td>
                  <div className="title-cell">
                    <span className="t-id">{formatItemId(it.id)} · {formatVersion(it.version)}</span>
                    <span className="t-name">{it.name}</span>
                    <span className="t-sum">{it.definition}</span>
                  </div>
                </td>
                <td><span className="tag">{it.category || '未分类'}</span></td>
                <td><Pill status={it.status} /></td>
                <td className="mono" style={{ fontSize: 12 }}>{formatVersion(it.version)}</td>
              </tr>
            ))}
            {!all.isLoading && filtered.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                {items.length === 0 ? '当前产品下无知识条目' : '无匹配条目'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
