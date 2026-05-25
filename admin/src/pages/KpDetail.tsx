import { useEffect, useState } from 'react';
import { Card, Descriptions, List, Select, Tag, Spin, Space, Button, message, Popconfirm } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getKp } from '../api/kp';
import { getKpDetail } from '../api/dashboard';
import { approveKp, listKpChunks, patchKp, unlinkChunk } from '../api/kp';
import { bindKpProducts } from '../api/product';
import { useActiveProduct } from '../context/ActiveProduct';

const statusColor: Record<string, string> = {
  draft: 'gold',
  approved: 'green',
  archived: 'default',
};

export default function KpDetail() {
  const { id } = useParams<{ id: string }>();
  const kpId = Number(id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['kp-detail', kpId], queryFn: () => getKpDetail(kpId) });
  const kpRaw = useQuery({ queryKey: ['kp-raw', kpId], queryFn: () => getKp(kpId) });
  const chunks = useQuery({
    queryKey: ['kp-chunks', kpId],
    queryFn: () => listKpChunks(kpId, { limit: 100 }),
  });
  const { products: allProducts } = useActiveProduct();
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);

  // 当 KP 详情加载后，把当前绑定的产品 ids 填入 Select
  useEffect(() => {
    if (kpRaw.data?.products) {
      setSelectedProducts(kpRaw.data.products.map((p: any) => p.id));
    }
  }, [kpRaw.data]);

  const bindProducts = useMutation({
    mutationFn: () => bindKpProducts(kpId, selectedProducts),
    onSuccess: () => {
      message.success('已更新产品绑定');
      qc.invalidateQueries({ queryKey: ['kp-raw'] });
      qc.invalidateQueries({ queryKey: ['kps'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  const approve = useMutation({
    mutationFn: () => approveKp(kpId),
    onSuccess: () => {
      message.success('已通过');
      qc.invalidateQueries({ queryKey: ['kp-detail'] });
    },
  });
  const archive = useMutation({
    mutationFn: () => patchKp(kpId, { status: 'archived' }),
    onSuccess: () => {
      message.success('已归档');
      qc.invalidateQueries({ queryKey: ['kp-detail'] });
    },
  });
  const unlink = useMutation({
    mutationFn: (chunkId: number) => unlinkChunk(kpId, chunkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kp-chunks'] }),
  });

  if (detail.isLoading) return <Spin />;
  const d = detail.data || {};

  return (
    <div>
      <Button onClick={() => nav(-1)} style={{ marginBottom: 12 }}>
        ← 返回
      </Button>
      <Card
        title={
          <Space>
            {d.name}
            <Tag color={statusColor[d.status] || 'default'}>{d.status}</Tag>
          </Space>
        }
        extra={
          <Space>
            {d.status !== 'approved' && (
              <Button type="primary" onClick={() => approve.mutate()}>
                通过
              </Button>
            )}
            {d.status !== 'archived' && (
              <Popconfirm title="确认归档？" onConfirm={() => archive.mutate()}>
                <Button danger>归档</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Descriptions column={2}>
          <Descriptions.Item label="分类">{d.category || '未分类'}</Descriptions.Item>
          <Descriptions.Item label="版本">{d.version}</Descriptions.Item>
          <Descriptions.Item label="关联 chunk 数">{d.chunk_count}</Descriptions.Item>
          <Descriptions.Item label="关联文档数">{(d.documents || []).length}</Descriptions.Item>
          <Descriptions.Item label="定义" span={2}>
            {d.definition || <i style={{ color: '#aaa' }}>无</i>}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="绑定产品" style={{ marginTop: 16 }}>
        <Space>
          <Select
            mode="multiple"
            style={{ minWidth: 360 }}
            placeholder="选择该 KP 适用的产品"
            value={selectedProducts}
            onChange={setSelectedProducts}
            options={allProducts.map((p) => ({ label: `${p.name} (${p.code})`, value: p.id }))}
          />
          <Button type="primary" loading={bindProducts.isPending} onClick={() => bindProducts.mutate()}>
            保存
          </Button>
          {(kpRaw.data?.products || []).map((p: any) => (
            <Tag key={p.id} color={p.source === 'manual' ? 'blue' : 'green'}>
              {p.name} ({p.source})
            </Tag>
          ))}
        </Space>
      </Card>

      <Card title="关联文档" style={{ marginTop: 16 }}>
        <List
          dataSource={d.documents || []}
          renderItem={(doc: any) => (
            <List.Item>
              <List.Item.Meta title={doc.doc_name} description={`贡献 ${doc.chunk_count} 个 chunk`} />
            </List.Item>
          )}
        />
      </Card>

      <Card title={`关联 chunk (${chunks.data?.length || 0})`} style={{ marginTop: 16 }}>
        <List
          loading={chunks.isLoading}
          dataSource={chunks.data || []}
          renderItem={(c: any) => (
            <List.Item
              actions={[
                <Popconfirm key="unlink" title="解绑该 chunk？" onConfirm={() => unlink.mutate(c.chunk_id)}>
                  <a>解绑</a>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag>{c.doc_name}</Tag>
                    <span style={{ color: '#888' }}>#{c.chunk_index}</span>
                    <Tag color={c.source === 'manual' ? 'blue' : 'default'}>{c.source}</Tag>
                    <span style={{ color: '#aaa' }}>rel={c.relevance.toFixed(2)}</span>
                  </Space>
                }
                description={<div style={{ whiteSpace: 'pre-wrap' }}>{c.text.slice(0, 300)}</div>}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
