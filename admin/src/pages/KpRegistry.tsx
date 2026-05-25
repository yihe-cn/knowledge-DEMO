import { useState } from 'react';
import { Card, Segmented, Space, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listKps } from '../api/kp';
import { useActiveProduct } from '../context/ActiveProduct';

const statusColor: Record<string, string> = {
  draft: 'gold',
  approved: 'green',
  archived: 'default',
};

export default function KpRegistry() {
  const [status, setStatus] = useState<string>('');
  const { productId } = useActiveProduct();
  const kps = useQuery({
    queryKey: ['kps', status || 'all', productId],
    queryFn: () => listKps({ status: status || undefined, limit: 200, product_id: productId }),
  });

  return (
    <Card
      title="KP 全量"
      extra={
        <Segmented
          value={status || 'all'}
          onChange={(v) => setStatus(v === 'all' ? '' : (v as string))}
          options={[
            { label: '全部', value: 'all' },
            { label: 'draft', value: 'draft' },
            { label: 'approved', value: 'approved' },
            { label: 'archived', value: 'archived' },
          ]}
        />
      }
    >
      <Table
        rowKey="id"
        loading={kps.isLoading}
        dataSource={kps.data || []}
        pagination={{ pageSize: 30 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          {
            title: '名称',
            dataIndex: 'name',
            render: (n: string, r: any) => <Link to={`/kp/${r.id}`}>{n}</Link>,
          },
          { title: '分类', dataIndex: 'category', width: 120 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
          },
          {
            title: '定义',
            dataIndex: 'definition',
            render: (d: string) => <span style={{ color: '#666' }}>{(d || '').slice(0, 80)}</span>,
          },
          { title: '版本', dataIndex: 'version', width: 70 },
        ]}
      />
    </Card>
  );
}
