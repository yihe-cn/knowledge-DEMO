import { useState, useMemo } from 'react';
import { I } from '../icons';
import { PageHeader, Pill } from '../components/primitives';
import {
  useItems, useItem, useItemChunks, useDocChunks, useApproveItem,
  formatItemId, formatVersion,
} from '../api';

export default function Review() {
  const queue = useItems({ status: 'draft', limit: 200 });
  const queueItems = queue.data || [];
  const [activeId, setActiveId] = useState<number | null>(null);
  const effectiveId = activeId ?? queueItems[0]?.id ?? null;

  const active = useItem(effectiveId);
  const chunks = useItemChunks(effectiveId);
  const approve = useApproveItem();

  const firstDocId = useMemo(() => {
    const c = chunks.data?.[0];
    return c?.document_id ?? c?.doc_id ?? c?.document?.id ?? null;
  }, [chunks.data]);
  const docChunks = useDocChunks(firstDocId);

  const onApprove = () => {
    if (!effectiveId) return;
    approve.mutate(effectiveId, {
      onSuccess: () => {
        const remaining = queueItems.filter(i => i.id !== effectiveId);
        setActiveId(remaining[0]?.id ?? null);
      },
    });
  };

  return (
    <>
      <PageHeader
        crumbs={['审核运营', '审核工作台']}
        title="审核工作台"
        desc="并排查看抽取出来的条目内容与原始文件片段，确认无误后再发布。"
        actions={<>
          <button className="btn"><I.Refresh /> 刷新</button>
          <button className="btn primary" disabled={!effectiveId || approve.isPending} onClick={onApprove}>
            <I.Check /> {approve.isPending ? '发布中…' : '通过当前并下一条'}
          </button>
        </>}
      />

      <div className="bench">
        {/* 列 1：队列 */}
        <div className="bench-col">
          <div className="bench-col-h">
            <h2 className="h2">待审队列 <span className="mono muted" style={{ fontSize: 11 }}>{queueItems.length}</span></h2>
          </div>
          {queue.isLoading && <div className="card-b muted">加载中…</div>}
          {!queue.isLoading && queueItems.length === 0 && (
            <div className="card-b muted">当前没有需要审核的条目</div>
          )}
          {queueItems.map(it => (
            <div key={it.id}
                 className={'queue-item' + (it.id === effectiveId ? ' on' : '')}
                 onClick={() => setActiveId(it.id)}>
              <div className="qi-cat">{it.category || '未分类'} · <Pill status={it.status} /></div>
              <div className="qi-title">{it.name}</div>
              <div className="qi-sum">{it.definition}</div>
              <div className="qi-meta">{formatItemId(it.id)} · {formatVersion(it.version)}</div>
            </div>
          ))}
        </div>

        {/* 列 2：结构化抽取内容 */}
        <div className="bench-col">
          <div className="bench-col-h">
            <h2 className="h2"><I.Sparkle /> 抽取结果</h2>
            {active.data && (
              <div className="mono muted" style={{ fontSize: 11 }}>
                {formatItemId(active.data.id)} · {formatVersion(active.data.version)}
              </div>
            )}
          </div>
          {!active.data && <div className="card-b muted">从左侧选择一条进行查看</div>}
          {active.data && (
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>
                {active.data.name}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                <Pill status={active.data.status} />
                <span className="tag">{active.data.category || '未分类'}</span>
                {active.data.products?.map(p => (
                  <span key={p.id} className="tag solid">{p.name}</span>
                ))}
              </div>

              <div style={{
                background: 'var(--surface-2)', border: '1px solid var(--divider)',
                borderRadius: 8, padding: 12, marginBottom: 14,
              }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>定义</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {active.data.definition || '（无内容）'}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  关联源块 ({chunks.data?.length ?? 0})
                </div>
                {chunks.isLoading && <div className="muted" style={{ fontSize: 12 }}>加载中…</div>}
                {!chunks.isLoading && (chunks.data?.length ?? 0) === 0 && (
                  <div className="muted" style={{ fontSize: 12 }}>该条目尚未关联源块</div>
                )}
                {chunks.data?.map((c, i) => {
                  const text = c.text ?? c.content ?? c.chunk_text ?? '';
                  return (
                    <div key={i} style={{
                      fontSize: 12, padding: '6px 10px', background: 'var(--surface-2)',
                      borderRadius: 4, marginBottom: 6, color: 'var(--ink-2)',
                    }}>
                      <span className="mono muted">#{c.chunk_id ?? c.id}</span>{'  '}{text.slice(0, 160)}{text.length > 160 ? '…' : ''}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, paddingTop: 14, borderTop: '1px solid var(--divider)' }}>
                <button className="btn primary" disabled={approve.isPending} onClick={onApprove}>
                  <I.Check /> 通过
                </button>
                <button className="btn"><I.Comment /> 退回修改</button>
              </div>
            </div>
          )}
        </div>

        {/* 列 3：源文档 */}
        <div className="bench-col">
          <div className="bench-col-h">
            <h2 className="h2"><I.Doc /> 源文档片段</h2>
            {firstDocId && <button className="btn ghost sm"><I.External /> 打开文档</button>}
          </div>
          {!firstDocId && <div className="card-b muted">当前条目尚未关联源文档</div>}
          {firstDocId && (
            <div className="source-doc">
              <div className="src-meta">
                Document #{firstDocId} · 共 {docChunks.data?.total ?? 0} 个片段
              </div>
              {docChunks.isLoading && <div className="muted">加载中…</div>}
              {docChunks.data?.items.map((c: any, i: number) => {
                const text = c.text ?? c.content ?? c.chunk_text ?? '';
                return (
                  <p key={i}>
                    <span className="mono muted" style={{ fontSize: 11, marginRight: 6 }}>#{c.id ?? c.chunk_id}</span>
                    {text}
                  </p>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
