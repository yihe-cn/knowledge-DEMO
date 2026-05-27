import { Card, Empty, Space, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getStats } from '../api/assessment';

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: '#999' }}>-</span>;
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 80 ? '#52c41a' : pct >= 60 ? '#1677ff' : '#ff7a45';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 120, height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span>{value.toFixed(1)}</span>
    </div>
  );
}

export default function AssessmentStats() {
  const statsQuery = useQuery({ queryKey: ['assessment-stats'], queryFn: getStats });
  const data = statsQuery.data;

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card title="按模板维度">
        {!data ? null : data.by_template.length === 0 ? (
          <Empty />
        ) : (
          <Table
            rowKey="template_id"
            pagination={false}
            dataSource={data.by_template}
            columns={[
              { title: 'ID', dataIndex: 'template_id', width: 70 },
              { title: '标题', dataIndex: 'title' },
              { title: '已分配', dataIndex: 'assigned', width: 90 },
              { title: '已完成', dataIndex: 'graded', width: 90 },
              {
                title: '均分',
                dataIndex: 'avg_score',
                width: 240,
                render: (v: number | null) => <ScoreBar value={v} />,
              },
            ]}
          />
        )}
      </Card>

      <Card title="按学员维度">
        {!data ? null : data.by_learner.length === 0 ? (
          <Empty />
        ) : (
          <Table
            rowKey="learner_id"
            pagination={false}
            dataSource={data.by_learner}
            columns={[
              { title: 'ID', dataIndex: 'learner_id', width: 70 },
              { title: '姓名', dataIndex: 'name' },
              { title: '已分配', dataIndex: 'assigned', width: 90 },
              {
                title: '均分',
                dataIndex: 'avg_score',
                width: 240,
                render: (v: number | null) => <ScoreBar value={v} />,
              },
            ]}
          />
        )}
      </Card>

      <Card title="按知识点维度（来自每题 AI 评分的 kp_tags）">
        {!data ? null : data.by_kp.length === 0 ? (
          <Empty description="还没有评分数据" />
        ) : (
          <Table
            rowKey="kp_id"
            pagination={false}
            dataSource={data.by_kp}
            columns={[
              { title: 'KP ID', dataIndex: 'kp_id', width: 90 },
              { title: '出现次数', dataIndex: 'count', width: 100 },
              {
                title: '均分',
                dataIndex: 'avg_score',
                width: 240,
                render: (v: number) => <ScoreBar value={v} />,
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
