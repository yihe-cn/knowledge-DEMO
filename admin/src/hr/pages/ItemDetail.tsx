import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { I } from '../icons';
import { PageHeader, Pill } from '../components/primitives';
import {
  useItem, useItemChunks, useApproveItem,
  relativeTime, formatItemId, formatVersion,
} from '../api';

export default function ItemDetail() {
  const { id: rawId } = useParams();
  const id = rawId ? Number(rawId) : null;
  const nav = useNavigate();
  const item = useItem(id);
  const chunks = useItemChunks(id);
  const approve = useApproveItem();
  const [tab, setTab] = useState('content');

  if (item.isLoading) {
    return <div className="muted" style={{ padding: 24 }}>加载中…</div>;
  }
  if (!item.data) {
    return <div className="muted" style={{ padding: 24 }}>条目不存在或已被删除。</div>;
  }
  const it = item.data;
  const chunkCount = chunks.data?.length ?? 0;

  const tabs: Array<[string, string, number | null]> = [
    ['content', '正文',      null],
    ['source',  '源文档对照', chunkCount],
    ['meta',    '元数据',     null],
  ];

  return (
    <>
      <PageHeader
        crumbs={[
          <a key="lib" onClick={() => nav('/hr/library')} style={{ cursor: 'pointer', color: 'inherit' }}>知识条目</a>,
          it.category || '未分类',
          <span key="id" className="mono">{formatItemId(it.id)}</span>,
        ]}
        title={it.name}
        desc={it.definition}
        actions={<>
          {it.status === 'draft' && (
            <button className="btn primary" disabled={approve.isPending}
                    onClick={() => approve.mutate(it.id, { onSuccess: () => nav('/hr/library') })}>
              <I.Check /> {approve.isPending ? '发布中…' : '通过并发布'}
            </button>
          )}
          {it.status === 'approved' && (
            <button className="btn"><I.Bolt /> 创建修订版</button>
          )}
        </>}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <Pill status={it.status} />
        <span className="tag">{it.category || '未分类'}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
          {formatVersion(it.version)}
          {it.updated_at ? ` · 更新于 ${relativeTime(it.updated_at)}` : ''}
          {it.created_by ? ` · 创建人 ${it.created_by}` : ''}
        </span>
      </div>

      <div className="item-grid">
        <div>
          <div className="card">
            <div className="tabs">
              {tabs.map(([k, l, c]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {l}{c != null && <span className="tab-count mono">{c}</span>}
                </button>
              ))}
            </div>
            {tab === 'content' && <ContentTab definition={it.definition} />}
            {tab === 'source'  && <SourceTab loading={chunks.isLoading} items={chunks.data || []} />}
            {tab === 'meta'    && <MetaTab item={it} />}
          </div>
        </div>

        <div className="col">
          <div className="card">
            <h3 className="h3" style={{ marginBottom: 12 }}>元数据</h3>
            <div className="meta-list">
              <div className="meta-row"><span className="lab">ID</span><span className="val mono">{formatItemId(it.id)}</span></div>
              <div className="meta-row"><span className="lab">分类</span><span className="val">{it.category || '—'}</span></div>
              <div className="meta-row"><span className="lab">状态</span><span className="val"><Pill status={it.status} /></span></div>
              <div className="meta-row"><span className="lab">版本</span><span className="val mono">{formatVersion(it.version)}</span></div>
              {it.updated_at && <div className="meta-row"><span className="lab">更新</span><span className="val mono">{relativeTime(it.updated_at)}</span></div>}
              {it.created_by && (
                <div className="meta-row"><span className="lab">创建人</span><span className="val">{it.created_by}</span></div>
              )}
              <div className="meta-row"><span className="lab">关联块</span><span className="val mono">{chunkCount}</span></div>
            </div>
          </div>

          {it.products && it.products.length > 0 && (
            <div className="card">
              <h3 className="h3" style={{ marginBottom: 10 }}>关联产品</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {it.products.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <I.Link />
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <span className="mono muted">{p.code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ContentTab({ definition }: { definition: string }) {
  if (!definition) return <div className="muted" style={{ padding: 24, textAlign: 'center' }}>暂无正文</div>;
  return (
    <div className="prose">
      <p style={{ whiteSpace: 'pre-wrap' }}>{definition}</p>
    </div>
  );
}

function SourceTab({ loading, items }: { loading: boolean; items: any[] }) {
  if (loading) return <div className="muted" style={{ padding: 24, textAlign: 'center' }}>加载中…</div>;
  if (!items.length) return <div className="muted" style={{ padding: 24, textAlign: 'center' }}>该条目尚未关联任何源文片段</div>;
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        本条目从以下 {items.length} 个源文件片段抽取与合并：
      </div>
      {items.map((c, i) => {
        const text = c.text ?? c.content ?? c.chunk_text ?? '（无内容）';
        const docName = c.document?.file_name ?? c.doc_name ?? `Chunk #${c.chunk_id ?? c.id}`;
        const rel = c.relevance ?? c.score;
        return (
          <div key={i} className="card" style={{ marginBottom: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <I.Doc />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{docName}</span>
              <span className="tag">#{c.chunk_id ?? c.id}</span>
              {rel != null && <span className="mono muted" style={{ fontSize: 11 }}>相关度 {Number(rel).toFixed(2)}</span>}
              <span style={{ flex: 1 }} />
              <button className="btn ghost sm"><I.External /> 跳转源文</button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)', background: 'var(--surface-2)', padding: 10, borderRadius: 6 }}>
              {text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetaTab({ item }: { item: any }) {
  return (
    <pre style={{
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--ink-2)',
      background: 'var(--surface-2)', padding: 12, borderRadius: 6,
    }}>{JSON.stringify(item, null, 2)}</pre>
  );
}
