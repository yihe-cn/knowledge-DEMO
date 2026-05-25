import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { I } from '../icons';
import { useItems, formatItemId } from '../api';
import { UploadDocButton } from './primitives';
import { useActiveProduct } from '../../context/ActiveProduct';
import { getInternalToken, setInternalToken } from '../../api/client';

function ProductPicker() {
  const { productId, setProductId, products, loading } = useActiveProduct();
  return (
    <select
      className="hr-product-picker"
      disabled={loading}
      value={productId ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        setProductId(v === '' ? null : Number(v));
      }}
      title="当前操作的归属产品"
    >
      <option value="">{loading ? '加载中…' : '选择归属产品'}</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>
      ))}
    </select>
  );
}

type Counts = { items: number; docs: number; review: number };

export function Sidebar({
  route, counts, collapsed, onToggle,
}: {
  route: string; counts: Counts; collapsed: boolean; onToggle: () => void;
}) {
  const nav = useNavigate();
  const Item = ({ id, icon, label, count, path }: {
    id: string; icon: React.ReactNode; label: string; count?: number; path: string;
  }) => (
    <div
      className={'nav-item' + (route === id ? ' active' : '')}
      onClick={() => nav(path)}
      title={collapsed ? label : undefined}
    >
      <span className="nav-ic">{icon}</span>
      <span className="nav-label">{label}</span>
      {count != null && <span className="nav-count mono">{count}</span>}
    </div>
  );
  return (
    <aside className="side">
      <Item id="overview" path="/hr"           icon={<I.Home />}    label="工作台" />
      <div className="side-section-label">知识维护</div>
      <Item id="library"  path="/hr/library"   icon={<I.Book />}    label="知识条目" count={counts.items} />
      <Item id="docs"     path="/hr/docs"      icon={<I.Doc />}     label="源文件库" count={counts.docs} />
      <Item id="taxonomy" path="/hr/taxonomy"  icon={<I.Tag />}     label="分类与标签" />
      <div className="side-section-label">审核运营</div>
      <Item id="review"   path="/hr/review"    icon={<I.Inbox />}   label="审核工作台" count={counts.review} />
      <Item id="insights" path="/hr/insights"  icon={<I.Sparkle />} label="问答洞察" />
      <Item id="audit"    path="/hr/audit"     icon={<I.History />} label="变更与审计" />
      <div className="side-section-label">设置</div>
      <Item id="depts"    path="/hr/depts"     icon={<I.People />}  label="组织与成员" />
      <Item id="config"   path="/hr/config"    icon={<I.Gear />}    label="系统配置" />
      <div style={{ flex: 1 }} />
      <div className="nav-item ghost" onClick={onToggle} style={{ color: 'var(--muted)' }}>
        <span className="nav-ic"><I.Sidebar /></span>
        <span className="nav-label">收起侧栏</span>
      </div>
    </aside>
  );
}

export function Topbar({ onOpenCmd }: { onOpenCmd: () => void }) {
  const qc = useQueryClient();
  const configureToken = () => {
    const next = window.prompt('Internal Token（留空表示开发模式无 token）', getInternalToken());
    if (next == null) return;
    setInternalToken(next);
    qc.invalidateQueries();
  };

  return (
    <>
      <header className="logo">
        <div className="logo-mark">知</div>
        <div>
          <div className="logo-title">HR 知识中台</div>
          <div className="logo-sub">v2.4 · OPS</div>
        </div>
      </header>
      <header className="topbar">
        <button className="search-launcher" onClick={onOpenCmd}>
          <I.Search />
          <span>搜索条目、文件、员工提问、操作…</span>
          <span className="kbd">⌘K</span>
        </button>
        <div className="top-spacer" />
        <ProductPicker />
        <button className="btn ghost sm" title="变更通知">
          <I.Bell />
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: 'var(--st-expiring-fg)', marginLeft: -4, marginTop: -10,
          }} />
        </button>
        <button className="btn ghost sm" onClick={configureToken} title="设置 Internal Token">
          <I.Gear /> Token
        </button>
        <button className="btn sm"><I.Plus />新建条目</button>
        <UploadDocButton className="btn primary sm" />
        <div className="user-chip">
          <span className="avatar">陈</span>
          <span>陈思雨 · HRBP</span>
        </div>
      </header>
    </>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const allItems = useItems({ limit: 500 });

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const ql = q.trim().toLowerCase();
  const pool = allItems.data || [];
  const items = ql
    ? pool.filter(it =>
        (it.name || '').toLowerCase().includes(ql) ||
        (it.definition || '').toLowerCase().includes(ql) ||
        String(it.id).includes(ql),
      ).slice(0, 6)
    : pool.slice(0, 4);

  const highlight = (text: string) => {
    if (!ql) return text;
    const idx = text.toLowerCase().indexOf(ql);
    if (idx < 0) return text;
    return <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + ql.length)}</mark>
      {text.slice(idx + ql.length)}
    </>;
  };

  if (!open) return null;
  const goto = (p: string) => { nav(p); onClose(); };

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd" onClick={e => e.stopPropagation()}>
        <div className="cmd-input">
          <I.Search />
          <input
            ref={inputRef}
            placeholder="搜知识条目、员工提问、跳转页面…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <span className="kbd-hint">ESC 关闭</span>
        </div>
        <div className="cmd-body">
          {!ql && (
            <>
              <div className="cmd-group">快速跳转</div>
              <div className="cmd-item" onClick={() => goto('/hr/review')}>
                <I.Inbox /> <span>审核工作台</span><span className="tail">G R</span>
              </div>
              <div className="cmd-item" onClick={() => goto('/hr/insights')}>
                <I.Sparkle /> <span>员工问答未命中</span><span className="tail">G I</span>
              </div>
              <div className="cmd-item" onClick={onClose}>
                <I.Plus /> <span>新建知识条目</span><span className="tail">N</span>
              </div>
              <div className="cmd-item" onClick={() => goto('/hr/docs')}>
                <I.Upload /> <span>导入制度文件</span><span className="tail">U</span>
              </div>
            </>
          )}

          <div className="cmd-group">{ql ? `匹配条目（${items.length}）` : '最近条目'}</div>
          {items.map(it => (
            <div key={it.id} className="cmd-item" onClick={() => goto(`/hr/items/${it.id}`)}>
              <I.Book />
              <span>{highlight(it.name || '')}</span>
              <span className="tail">{formatItemId(it.id)}</span>
            </div>
          ))}
          {items.length === 0 && (
            <div className="cmd-item" style={{ color: 'var(--muted)' }}>
              <I.X /> <span>{allItems.isLoading ? '加载中…' : '无匹配条目'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
