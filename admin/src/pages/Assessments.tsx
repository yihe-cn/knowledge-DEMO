import { useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createTemplate, listTemplates, type AssessmentTemplate } from '../api/assessment';

const modeColor: Record<string, string> = {
  bank: 'blue',
  ai_oral: 'purple',
};

export default function Assessments() {
  const qc = useQueryClient();
  const tplQuery = useQuery({ queryKey: ['assessment-templates'], queryFn: listTemplates });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const createMut = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      message.success('已创建');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['assessment-templates'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '创建失败'),
  });

  return (
    <Card
      title="考核模板"
      extra={
        <Space>
          <Link to="/hr/assessments/assignments">
            <Button>查看分配</Button>
          </Link>
          <Link to="/hr/assessments/stats">
            <Button>统计</Button>
          </Link>
          <Button type="primary" onClick={() => setOpen(true)}>
            新建模板
          </Button>
        </Space>
      }
    >
      <Table<AssessmentTemplate>
        rowKey="id"
        loading={tplQuery.isLoading}
        dataSource={tplQuery.data || []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          {
            title: '标题',
            dataIndex: 'title',
            render: (t, r) => <Link to={`/hr/assessments/${r.id}/edit`}>{t}</Link>,
          },
          {
            title: '模式',
            dataIndex: 'mode',
            width: 120,
            render: (m: string) => <Tag color={modeColor[m] || 'default'}>{m === 'bank' ? '固定题库' : 'AI 主考'}</Tag>,
          },
          { title: '题数 / 轮数', dataIndex: 'num_questions', width: 110 },
          { title: '及格分', dataIndex: 'pass_score', width: 90 },
          {
            title: '范围 KP 数',
            width: 110,
            render: (_, r) => (r.scope?.kp_ids || []).length,
          },
          {
            title: '更新',
            dataIndex: 'updated_at',
            width: 170,
            render: (s: string) => (s || '').slice(0, 16).replace('T', ' '),
          },
        ]}
      />

      <Modal
        title="新建考核模板"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ mode: 'bank', pass_score: 60, num_questions: 5 }}
          onFinish={(v) =>
            createMut.mutate({
              title: v.title,
              mode: v.mode,
              pass_score: v.pass_score,
              num_questions: v.num_questions,
              scope: { kp_ids: [], product_ids: [] },
              question_set: [],
            } as any)
          }
        >
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input placeholder="例如：极氪 007 - 入职考核" />
          </Form.Item>
          <Form.Item name="mode" label="模式">
            <Select
              options={[
                { value: 'bank', label: '固定题库（admin 出题，逐题作答）' },
                { value: 'ai_oral', label: 'AI 主考（AI 连续提问 + 综合评分）' },
              ]}
            />
          </Form.Item>
          <Space>
            <Form.Item name="num_questions" label="题数 / 轮数">
              <InputNumber min={1} max={30} />
            </Form.Item>
            <Form.Item name="pass_score" label="及格分">
              <InputNumber min={0} max={100} />
            </Form.Item>
          </Space>
          <div style={{ color: '#666', fontSize: 12 }}>
            创建后进入详情页配置范围 KP、出题（或让 AI 草拟）。
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
