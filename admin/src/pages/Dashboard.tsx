import { Card, Col, Row, List, Tag, Empty, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useActiveProduct } from '../context/ActiveProduct';

const attentionColor: Record<string, string> = {
  pending_kp: 'gold',
  failed_doc: 'red',
  kp_no_chunk: 'blue',
};

async function fetchOverview(productId: number | null) {
  const { data } = await api.get('/dashboard/overview', {
    params: productId != null ? { product_id: productId } : {},
  });
  return data;
}

async function fetchKpMap(productId: number | null) {
  const { data } = await api.get('/dashboard/kp-map', {
    params: productId != null ? { product_id: productId } : {},
  });
  return data;
}

async function fetchAttention(productId: number | null) {
  const { data } = await api.get('/dashboard/attention', {
    params: productId != null ? { product_id: productId } : {},
  });
  return data;
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
  const items = (mapData.items || []) as any[];

  const pieOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        name: groupedByProduct ? 'KP 总数' : 'KP 分类',
        type: 'pie',
        radius: ['55%', '75%'],
        data: items.map((it) => ({
          name: groupedByProduct ? it.product_name : it.category,
          value: it.total,
        })),
        label: { formatter: '{b}\n{c}' },
      },
      {
        name: 'Approved',
        type: 'pie',
        radius: ['25%', '50%'],
        data: items.map((it) => ({
          name: (groupedByProduct ? it.product_name : it.category) + ' 已通过',
          value: it.approved,
        })),
        label: { show: false },
      },
    ],
  };

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <div style={{ color: '#888' }}>KP 总数</div>
            <div style={{ fontSize: 28 }}>{o.kp_total ?? '-'}</div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ color: '#888' }}>Approved 比例</div>
            <div style={{ fontSize: 28 }}>
              {o.approved_ratio != null ? `${(o.approved_ratio * 100).toFixed(0)}%` : '-'}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ color: '#888' }}>文档总数</div>
            <div style={{ fontSize: 28 }}>{o.doc_total ?? '-'}</div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ color: '#888' }}>待审核 KP</div>
            <div style={{ fontSize: 28, color: '#faad14' }}>{o.pending_review ?? '-'}</div>
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card title={groupedByProduct ? 'KP 分布（按产品）' : 'KP 分布（按分类）'}>
            {map.isLoading ? (
              <Spin />
            ) : items.length === 0 ? (
              <Empty />
            ) : (
              <ReactECharts option={pieOption} style={{ height: 380 }} />
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card title={`待办 (${att.data?.total ?? 0})`} styles={{ body: { maxHeight: 380, overflow: 'auto' } }}>
            <List
              dataSource={(att.data?.items as any[]) || []}
              renderItem={(it: any) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <span>
                        <Tag color={attentionColor[it.type]}>{it.type}</Tag>
                        {it.type === 'pending_kp' || it.type === 'kp_no_chunk' ? (
                          <Link to={`/kp/${it.target_id}`}>{it.title}</Link>
                        ) : (
                          it.title
                        )}
                      </span>
                    }
                    description={it.detail}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
