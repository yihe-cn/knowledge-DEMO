import { useNavigate } from 'react-router-dom';
import { I } from '../icons';
import { PageHeader } from '../components/primitives';
import { useOverview, useAttention, useItems, formatItemId, type AttentionItem } from '../api';

export default function Overview() {
  const nav = useNavigate();
  const ov = useOverview();
  const at = useAttention();
  const data = ov.data;

  const total    = data?.kp_total ?? 0;
  const approved = data?.kp_approved ?? 0;
  const drafts   = data?.kp_draft ?? 0;
  const review   = data?.pending_review ?? 0;
  const docTotal = data?.doc_total ?? 0;
  const docReady = data?.doc_ready ?? 0;
  const docFail  = data?.doc_failed ?? 0;
  const approvedRatio = data?.approved_ratio != null ? Math.round(data.approved_ratio * 100) : 0;

  return (
    <>
      <PageHeader
        crumbs={['HR 中台', '工作台']}
        title="今日，知识库的状态"
        desc="本视图聚合了归口部门和审核人员需要关注的所有信号 — 待办、需关注、最近活动。"
        actions={<>
          <button className="btn" onClick={() => { ov.refetch(); at.refetch(); }}><I.Refresh /> 刷新</button>
          <button className="btn primary"><I.Plus /> 新建条目</button>
        </>}
      />

      <div className="kpi-grid">
        <div className="kpi featured">
          <div className="label">已发布条目</div>
          <div className="value mono">{approved}<span className="unit">/ {total}</span></div>
          <div className="trend">通过率 {approvedRatio}%</div>
        </div>
        <div className="kpi" onClick={() => nav('/hr/review')} style={{ cursor: 'pointer' }}>
          <div className="label"><I.Inbox /> 待审核</div>
          <div className="value mono" style={{ color: 'var(--st-review-fg)' }}>{review}</div>
          <div className="trend up">点击进入审核工作台</div>
        </div>
        <div className="kpi">
          <div className="label"><I.Bolt /> 草稿中</div>
          <div className="value mono">{drafts}</div>
          <div className="trend">待审核 + 已审通过前</div>
        </div>
        <div className="kpi">
          <div className="label"><I.Warning /> 需关注</div>
          <div className="value mono" style={{ color: 'var(--st-expiring-fg)' }}>{at.data?.total ?? 0}</div>
          <div className="trend down">见右侧"需要关注"列表</div>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div className="kpi">
          <div className="label"><I.Doc /> 源文件总数</div>
          <div className="value mono">{docTotal}</div>
          <div className="trend">已就绪 {docReady} · 失败 {docFail}</div>
        </div>
        <div className="kpi">
          <div className="label"><I.Layers /> 已归档</div>
          <div className="value mono">{data?.kp_archived ?? 0}</div>
          <div className="trend">不再向用户曝光</div>
        </div>
        <div className="kpi">
          <div className="label"><I.Eye /> 数据时点</div>
          <div className="value mono" style={{ fontSize: 18 }}>{new Date().toLocaleDateString('zh-CN')}</div>
          <div className="trend">仅展示当前 active product 数据</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 6 }}>
        <div className="col">
          <AttentionCard />
          <EmptyCard
            icon={<I.Comment />}
            title="员工高频提问（本周）"
            note="问答洞察后端暂未接入，待 HRBot 检索日志接口就绪后填充。"
          />
        </div>
        <div className="col">
          <RecentDraftsCard />
          <EmptyCard
            icon={<I.People />}
            title="各 Owner 负载"
            note="KP 当前不携带 owner 字段，待后端扩展 created_by/owner 后启用。"
          />
        </div>
      </div>
    </>
  );
}

function AttentionCard() {
  const nav = useNavigate();
  const at = useAttention();
  const items = at.data?.items || [];
  const targetPath = (a: AttentionItem) => {
    if (!a.target_id) return null;
    if (a.type === 'failed_doc') return `/hr/docs?doc=${a.target_id}`;
    return `/hr/items/${a.target_id}`;
  };
  return (
    <div className="card flush">
      <div className="card-h">
        <h2 className="h2"><I.Warning /> 需要关注</h2>
        <span className="muted mono" style={{ fontSize: 11 }}>共 {at.data?.total ?? 0} 条</span>
      </div>
      {at.isLoading && <div className="card-b muted">加载中…</div>}
      {!at.isLoading && items.length === 0 && (
        <div className="card-b muted">暂无需关注的事项</div>
      )}
      {items.slice(0, 6).map((a, i) => {
        const path = targetPath(a);
        return (
          <div key={i} className="card-b"
               style={{ borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 14, cursor: path ? 'pointer' : 'default' }}
               onClick={() => path && nav(path)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{a.title}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {a.type} · {a.detail}
              </div>
            </div>
            {path ? <I.Chevron /> : null}
          </div>
        );
      })}
    </div>
  );
}

function RecentDraftsCard() {
  const nav = useNavigate();
  const q = useItems({ status: 'draft', limit: 6 });
  const items = q.data || [];
  return (
    <div className="card flush">
      <div className="card-h">
        <h2 className="h2"><I.History /> 最近草稿</h2>
        <button className="btn ghost sm" onClick={() => nav('/hr/review')}>
          进入审核工作台 <I.External />
        </button>
      </div>
      <div className="card-b">
        {q.isLoading && <div className="muted">加载中…</div>}
        {!q.isLoading && items.length === 0 && <div className="muted">暂无草稿</div>}
        <div className="tl">
          {items.map(it => (
            <div key={it.id} className="tl-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/hr/items/${it.id}`)}>
              <div className="tl-t">{formatItemId(it.id)}</div>
              <div className="tl-msg"><b>{it.name}</b></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className="card flush">
      <div className="card-h">
        <h2 className="h2">{icon} {title}</h2>
        <span className="muted mono" style={{ fontSize: 11 }}>暂未接入</span>
      </div>
      <div className="card-b muted" style={{ fontSize: 12 }}>{note}</div>
    </div>
  );
}

// 让 TS 不抱怨未使用的 AttentionItem 类型导入（保留以备扩展）
export type _Attn = AttentionItem;
