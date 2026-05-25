import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { I } from '../icons';
import { PageHeader, Pill, UploadDocButton } from '../components/primitives';
import { useDoc, useDocChunks, useDocs, useReextractDoc, relativeTime } from '../api';

const statusStyle: Record<string, { pill: string; label: string }> = {
  ready:      { pill: 'approved', label: '已就绪' },
  processing: { pill: 'review',   label: '处理中' },
  pending:    { pill: 'draft',    label: '排队中' },
  failed:     { pill: 'expiring', label: '失败'   },
};

export default function Docs() {
  const docs = useDocs();
  const items = docs.data?.items || [];
  const loc = useLocation();
  const nav = useNavigate();
  const [detailId, setDetailId] = useState<number | null>(null);
  const reextract = useReextractDoc();

  useEffect(() => {
    const raw = new URLSearchParams(loc.search).get('doc');
    const id = raw ? Number(raw) : null;
    setDetailId(id && Number.isFinite(id) && id > 0 ? id : null);
  }, [loc.search]);

  const openDoc = (id: number) => {
    setDetailId(id);
    nav(`/hr/docs?doc=${id}`);
  };

  const closeDoc = () => {
    setDetailId(null);
    nav('/hr/docs', { replace: true });
  };

  const triggerReextract = (id: number) => {
    reextract.mutate(id, {
      onSuccess: () => alert('已触发重抽取'),
      onError: (err: any) =>
        alert('重抽取失败：' + (err?.response?.data?.detail || err?.message || '未知错误')),
    });
  };

  return (
    <>
      <PageHeader
        crumbs={['知识维护', '源文件库']}
        title="源文件库"
        desc={'制度原件、红头文件、PPT 等所有"事实源"。每个文件被切片后进入抽取流程，最终凝结成知识条目。'}
        actions={<>
          <button className="btn"><I.Filter /> 筛选</button>
          <UploadDocButton />
        </>}
      />

      <div className="card flush">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: '46%' }}>文件</th>
              <th>处理状态</th>
              <th style={{ textAlign: 'right' }}>切片</th>
              <th>关联产品</th>
              <th>上传时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.isLoading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>加载中…</td></tr>
            )}
            {!docs.isLoading && items.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>当前产品下无源文件</td></tr>
            )}
            {items.map(d => {
              const s = statusStyle[d.status] || { pill: 'archived', label: d.status };
              return (
                <tr key={d.id}>
                  <td>
                    <div className="title-cell">
                      <span className="t-id">D-{String(d.id).padStart(4, '0')}</span>
                      <span className="t-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <I.Doc /> {d.file_name}
                      </span>
                      {d.error && <span className="t-sum" style={{ color: 'var(--st-expiring-fg)' }}>{d.error}</span>}
                    </div>
                  </td>
                  <td><span className={'pill ' + s.pill}><span className="dot" />{s.label}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{d.chunk_count ?? 0}</td>
                  <td style={{ fontSize: 12 }}>
                    {d.product ? <span className="tag solid">{d.product.name}</span> : <span className="muted">—</span>}
                  </td>
	                  <td className="mono muted" style={{ fontSize: 12 }}>{relativeTime(d.created_at)}</td>
	                  <td>
	                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
	                      <button
	                        className="btn ghost sm"
	                        title="重抽取"
	                        disabled={reextract.isPending}
	                        onClick={() => triggerReextract(d.id)}
	                      >
	                        <I.Refresh />
	                      </button>
	                      <button className="btn ghost sm" title="打开" onClick={() => openDoc(d.id)}>
	                        <I.External />
	                      </button>
	                    </div>
	                  </td>
	                </tr>
	              );
	            })}
	          </tbody>
	        </table>
	      </div>

	      <DocDetail id={detailId} onClose={closeDoc} />
	    </>
	  );
	}

function DocDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const doc = useDoc(id);
  const chunks = useDocChunks(id);

  if (id == null) return null;

  const detail = doc.data;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 28, 48, 0.28)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 40,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: 'min(760px, calc(100vw - 32px))',
          height: '100vh',
          borderRadius: 0,
          overflow: 'auto',
          boxShadow: 'var(--shadow-pop)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-h" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <h2 className="h2"><I.Doc /> {detail?.file_name || `Document #${id}`}</h2>
          <button className="btn ghost sm" onClick={onClose}><I.X /> 关闭</button>
        </div>

        {doc.isLoading && <div className="card-b muted">加载中…</div>}
        {!doc.isLoading && !detail && <div className="card-b muted">文档不存在或已被删除。</div>}
        {detail && (
          <>
            <div className="card-b" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Pill status={statusStyle[detail.status]?.pill || detail.status}>
                {statusStyle[detail.status]?.label || detail.status}
              </Pill>
              <span className="tag">切片 {detail.chunk_count ?? 0}</span>
              {detail.product ? <span className="tag solid">{detail.product.name}</span> : <span className="tag">未绑定产品</span>}
              <span className="mono muted" style={{ fontSize: 12 }}>上传于 {relativeTime(detail.created_at)}</span>
            </div>

            {detail.error && (
              <div className="card-b" style={{ color: 'var(--st-expiring-fg)', background: 'var(--st-expiring-bg)' }}>
                {detail.error}
              </div>
            )}

            {detail.latest_job && (
              <div className="card-b mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                最近抽取：{detail.latest_job.status} · 候选 {detail.latest_job.candidate_count} · 新 KP {detail.latest_job.new_kp_count}
              </div>
            )}

            <div className="card-b">
              <h3 className="h3" style={{ marginBottom: 10 }}>源文切片</h3>
              {chunks.isLoading && <div className="muted">加载中…</div>}
              {!chunks.isLoading && (chunks.data?.items.length ?? 0) === 0 && (
                <div className="muted">暂无切片</div>
              )}
              <div className="source-doc">
                {chunks.data?.items.map((c: any) => (
                  <p key={c.id}>
                    <span className="mono muted" style={{ fontSize: 11, marginRight: 6 }}>#{c.chunk_index}</span>
                    {c.text}
                  </p>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
