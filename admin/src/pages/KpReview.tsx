import { useState } from 'react';
import { Button, Card, Empty, List, Space, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveKp, bulkApprove, listKpChunks, listKps, patchKp } from '../api/kp';
import { useActiveProduct } from '../context/ActiveProduct';
import KpMergeModal from '../components/KpMergeModal';

export default function KpReview() {
  const qc = useQueryClient();
  const { productId } = useActiveProduct();
  const draft = useQuery({
    queryKey: ['kps', 'draft', productId],
    queryFn: () => listKps({ status: 'draft', limit: 100, product_id: productId }),
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const chunks = useQuery({
    queryKey: ['kp-chunks', selectedId],
    queryFn: () => listKpChunks(selectedId!, { limit: 20 }),
    enabled: !!selectedId,
  });

  const approve = useMutation({
    mutationFn: approveKp,
    onSuccess: () => {
      message.success('已通过');
      qc.invalidateQueries({ queryKey: ['kps'] });
    },
  });

  const archive = useMutation({
    mutationFn: (id: number) => patchKp(id, { status: 'archived' }),
    onSuccess: () => {
      message.success('已归档');
      qc.invalidateQueries({ queryKey: ['kps'] });
    },
  });

  const bulk = useMutation({
    mutationFn: bulkApprove,
    onSuccess: (d) => {
      message.success(`已批量通过 ${d.approved} 个`);
      qc.invalidateQueries({ queryKey: ['kps'] });
    },
  });

  const list = draft.data || [];
  const selected = list.find((k) => k.id === selectedId);

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <Card
        title={`待审核 KP (${list.length})`}
        style={{ width: 360 }}
        extra={
          <Button
            size="small"
            disabled={list.length === 0}
            onClick={() => bulk.mutate(list.map((k) => k.id))}
          >
            全部通过
          </Button>
        }
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto', padding: 0 }}
      >
        <List
          dataSource={list}
          renderItem={(k) => (
            <List.Item
              onClick={() => setSelectedId(k.id)}
              style={{
                padding: 12,
                cursor: 'pointer',
                background: selectedId === k.id ? '#e6f4ff' : undefined,
              }}
            >
              <List.Item.Meta
                title={k.name}
                description={
                  <Space>
                    <Tag>{k.category || '未分类'}</Tag>
                    <span style={{ color: '#888' }}>{(k.definition || '').slice(0, 40)}</span>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Card title={selected ? selected.name : '请选择左侧 KP'} style={{ flex: 1 }}>
        {!selected ? (
          <Empty />
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <Tag>{selected.category || '未分类'}</Tag>
              <div style={{ marginTop: 8 }}>{selected.definition || <i style={{ color: '#aaa' }}>无定义</i>}</div>
            </div>
            <Space style={{ marginBottom: 12 }}>
              <Button type="primary" onClick={() => approve.mutate(selected.id)}>
                通过
              </Button>
              <Button onClick={() => setMergeOpen(true)}>合并到已有 KP</Button>
              <Button danger onClick={() => archive.mutate(selected.id)}>
                归档
              </Button>
            </Space>
            <div style={{ fontWeight: 600, marginTop: 16, marginBottom: 8 }}>
              关联 chunk ({chunks.data?.length || 0})
            </div>
            <List
              dataSource={chunks.data || []}
              renderItem={(c: any) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <span>
                        <Tag>{c.doc_name}</Tag>
                        <span style={{ color: '#888' }}>#{c.chunk_index}</span>
                      </span>
                    }
                    description={<div style={{ whiteSpace: 'pre-wrap' }}>{c.text.slice(0, 300)}</div>}
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </Card>

      <KpMergeModal
        open={mergeOpen}
        sourceKp={selected || null}
        onClose={() => setMergeOpen(false)}
        onMerged={() => {
          setMergeOpen(false);
          setSelectedId(null);
          qc.invalidateQueries({ queryKey: ['kps'] });
        }}
      />
    </div>
  );
}
