import { Empty, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useActiveProduct } from '../context/ActiveProduct';
import { I } from '../hr/icons';

type Overview = {
  kp_total?: number;
  kp_approved?: number;
  kp_draft?: number;
  kp_archived?: number;
  approved_ratio?: number;
  doc_total?: number;
  doc_ready?: number;
  doc_failed?: number;
  doc_pending?: number;
  pending_review?: number;
};

type KpMapItem = {
  product_id?: number;
  product_code?: string;
  product_name?: string;
  category?: string;
  total: number;
  approved: number;
  draft: number;
};

type KpMap = {
  group_by: 'product' | 'category';
  items: KpMapItem[];
};

type AttentionItem = {
  type: 'pending_kp' | 'failed_doc' | 'kp_no_chunk' | string;
  target_id: number;
  title: string;
  detail?: string;
};

const attentionMeta: Record<string, { label: string; tone: string; action: string }> = {
  pending_kp: { label: '待审核', tone: 'review', action: '去审核' },
  failed_doc: { label: '解析失败', tone: 'danger', action: '查看文件' },
  kp_no_chunk: { label: '缺素材', tone: 'warning', action: '补充素材' },
};

async function fetchOverview(productId: number | null): Promise<Overview> {
  const { data } = await api.get('/dashboard/overview', {
    params: productId != null ? { product_id: productId } : {},
  });
  return data;
}

async function fetchKpMap(productId: number | null): Promise<KpMap> {
  const { data } = await api.get('/dashboard/kp-map', {
    params: productId != null ? { product_id: productId } : {},
  });
  return data;
}

async function fetchAttention(productId: number | null): Promise<{ items: AttentionItem[]; total: number }> {
  const { data } = await api.get('/dashboard/attention', {
    params: productId != null ? { product_id: productId } : {},
  });
  return data;
}

function pct(value?: number) {
  if (value == null) return '-';
  return `${Math.round(value * 100)}%`;
}

function count(value?: number) {
  return value == null ? '-' : value.toLocaleString('zh-CN');
}

function mapLabel(item: KpMapItem, groupedByProduct: boolean) {
  return groupedByProduct ? item.product_name || item.product_code || '未命名产品' : item.category || '未分类';
}

function cleanTitle(item: AttentionItem) {
  return item.title.replace(/^待审核 KP：/, '').replace(/^文档解析失败：/, '').replace(/^KP 无关联素材：/, '');
}

export default function Dashboard() {
  const { productId } = useActiveProduct();
  const ov = useQuery({ queryKey: ['overview', productId], queryFn: () => fetchOverview(productId) });
  const map = useQuery({ queryKey: ['kp-map', productId], queryFn: () => fetchKpMap(productId) });
  const att = useQuery({
    queryKey: ['attention', productId],
    queryFn: () => fetchAttention(productId),
  });

  const o = ov.data || {};
  const mapData = map.data || { group_by: 'product', items: [] };
  const groupedByProduct = mapData.group_by === 'product';
  const items = [...(mapData.items || [])]
    .filter((it) => Number(it.total || 0) > 0)
    .sort((a, b) => (b.total || 0) - (a.total || 0));
  const topItems = items.slice(0, 8);
  const attentionItems = att.data?.items || [];
  const docIssueCount = (o.doc_failed || 0) + (o.doc_pending || 0);
  const approvedRatio = o.approved_ratio ?? 0;
  const readyDocRatio = o.doc_total ? (o.doc_ready || 0) / o.doc_total : 0;
  const reviewPressure = o.kp_total ? (o.pending_review || 0) / o.kp_total : 0;

  const coverageOption = {
    color: ['#2563eb', '#f59e0b', '#94a3b8'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any[]) => {
        const row = params[0];
        const item = topItems[row.dataIndex];
        return `${mapLabel(item, groupedByProduct)}<br/>已通过：${item.approved}<br/>待审核：${item.draft}<br/>总数：${item.total}`;
      },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    grid: { top: 36, left: 8, right: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#94a3b8' },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: topItems.map((it) => mapLabel(it, groupedByProduct)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#334155', width: 110, overflow: 'truncate' },
    },
    series: [
      {
        name: '已通过',
        type: 'bar',
        stack: 'total',
        barWidth: 14,
        data: topItems.map((it) => it.approved || 0),
      },
      {
        name: '待审核',
        type: 'bar',
        stack: 'total',
        data: topItems.map((it) => it.draft || 0),
      },
      {
        name: '其他',
        type: 'bar',
        stack: 'total',
        data: topItems.map((it) => Math.max((it.total || 0) - (it.approved || 0) - (it.draft || 0), 0)),
      },
    ],
  };

  const weakItems = items
    .filter((it) => it.total > 0)
    .sort((a, b) => {
      const aRatio = (a.approved || 0) / a.total;
      const bRatio = (b.approved || 0) / b.total;
      return aRatio - bRatio || b.draft - a.draft;
    })
    .slice(0, 5);

  return (
    <div className="dashboard-modern">
      <section className="dash-hero">
        <div>
          <div className="dash-eyebrow">Knowledge Operations</div>
          <h1>工作台</h1>
          <p>聚焦当前产品的知识覆盖、审核压力和需要处理的异常。</p>
        </div>
        <div className="dash-hero-actions">
          <Link className="btn" to="/hr/docs">
            <I.Upload /> 导入文件
          </Link>
          <Link className="btn primary" to="/hr/review">
            <I.Inbox /> 处理审核
          </Link>
        </div>
      </section>

      <section className="dash-metrics">
        <article className="dash-metric primary">
          <div className="dash-metric-icon"><I.Book /></div>
          <div className="dash-metric-label">KP 总数</div>
          <div className="dash-metric-value">{count(o.kp_total)}</div>
          <div className="dash-metric-note">已通过 {count(o.kp_approved)} · 草稿 {count(o.kp_draft)}</div>
        </article>
        <article className="dash-metric">
          <div className="dash-metric-icon ok"><I.Check /></div>
          <div className="dash-metric-label">通过率</div>
          <div className="dash-metric-value">{pct(o.approved_ratio)}</div>
          <div className="dash-progress"><span style={{ width: `${Math.min(approvedRatio * 100, 100)}%` }} /></div>
        </article>
        <article className="dash-metric">
          <div className="dash-metric-icon info"><I.Doc /></div>
          <div className="dash-metric-label">文档覆盖</div>
          <div className="dash-metric-value">{count(o.doc_total)}</div>
          <div className="dash-metric-note">可用 {count(o.doc_ready)} · 异常 {count(docIssueCount)}</div>
        </article>
        <article className="dash-metric attention">
          <div className="dash-metric-icon warn"><I.Inbox /></div>
          <div className="dash-metric-label">待处理</div>
          <div className="dash-metric-value">{count(att.data?.total ?? o.pending_review)}</div>
          <div className="dash-metric-note">待审核 KP {count(o.pending_review)}</div>
        </article>
      </section>

      <section className="dash-grid">
        <article className="dash-panel dash-panel-large">
          <header className="dash-panel-head">
            <div>
              <h2>{groupedByProduct ? '产品知识覆盖' : 'KP 分类覆盖'}</h2>
              <p>按总量排序展示 Top 8，并拆分已通过与待审核。</p>
            </div>
            <Link to="/hr/library">查看全部 <I.Arrow /></Link>
          </header>
          <div className="dash-chart">
            {map.isLoading ? (
              <Spin />
            ) : topItems.length === 0 ? (
              <Empty description="暂无 KP 数据" />
            ) : (
              <ReactECharts option={coverageOption} style={{ height: 328 }} notMerge />
            )}
          </div>
        </article>

        <aside className="dash-panel">
          <header className="dash-panel-head compact">
            <div>
              <h2>知识健康度</h2>
              <p>当前范围的关键运行信号。</p>
            </div>
          </header>
          <div className="health-list">
            <div className="health-row">
              <span>KP 通过率</span>
              <strong>{pct(o.approved_ratio)}</strong>
              <div className="dash-progress"><span style={{ width: `${Math.min(approvedRatio * 100, 100)}%` }} /></div>
            </div>
            <div className="health-row">
              <span>文档可用率</span>
              <strong>{pct(readyDocRatio)}</strong>
              <div className="dash-progress ok"><span style={{ width: `${Math.min(readyDocRatio * 100, 100)}%` }} /></div>
            </div>
            <div className="health-row">
              <span>审核压力</span>
              <strong>{pct(reviewPressure)}</strong>
              <div className="dash-progress warn"><span style={{ width: `${Math.min(reviewPressure * 100, 100)}%` }} /></div>
            </div>
          </div>
          <div className="dash-sep" />
          <div className="weak-list">
            <div className="weak-title">优先补齐</div>
            {weakItems.length === 0 ? (
              <div className="dash-empty">暂无薄弱分类</div>
            ) : (
              weakItems.map((it) => (
                <div className="weak-item" key={mapLabel(it, groupedByProduct)}>
                  <span>{mapLabel(it, groupedByProduct)}</span>
                  <b>{pct(it.total ? it.approved / it.total : 0)}</b>
                </div>
              ))
            )}
          </div>
        </aside>
      </section>

      <section className="dash-grid bottom">
        <article className="dash-panel">
          <header className="dash-panel-head">
            <div>
              <h2>待办队列</h2>
              <p>需要运营人员处理的审核、解析和素材问题。</p>
            </div>
            <Link to="/hr/review">审核台 <I.Arrow /></Link>
          </header>
          <div className="task-list">
            {att.isLoading ? (
              <Spin />
            ) : attentionItems.length === 0 ? (
              <Empty description="暂无待办" />
            ) : (
              attentionItems.slice(0, 6).map((item) => {
                const meta = attentionMeta[item.type] || { label: item.type, tone: 'neutral', action: '查看' };
                const detailLink = item.type === 'failed_doc' ? '/hr/docs' : `/hr/items/${item.target_id}`;
                return (
                  <div className="task-item" key={`${item.type}-${item.target_id}`}>
                    <div className={`task-badge ${meta.tone}`}>{meta.label}</div>
                    <div className="task-main">
                      <Link className="task-title" to={detailLink}>{cleanTitle(item)}</Link>
                      <p>{item.detail || '暂无说明'}</p>
                    </div>
                    <Link className="task-action" to={detailLink}>{meta.action}</Link>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="dash-panel">
          <header className="dash-panel-head compact">
            <div>
              <h2>运营建议</h2>
              <p>按当前数据自动给出下一步。</p>
            </div>
          </header>
          <div className="advice-list">
            <div className="advice-item">
              <I.Inbox />
              <div>
                <strong>先清理待审核 KP</strong>
                <p>待审核数量会直接影响通过率和学员端可用知识。</p>
              </div>
            </div>
            <div className="advice-item">
              <I.Doc />
              <div>
                <strong>检查失败或处理中源文件</strong>
                <p>文档异常会造成 KP 缺上下文，优先处理能减少后续返工。</p>
              </div>
            </div>
            <div className="advice-item">
              <I.Tag />
              <div>
                <strong>补齐低通过率分类</strong>
                <p>分类覆盖不均时，AIQA 的回答稳定性会明显下降。</p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
