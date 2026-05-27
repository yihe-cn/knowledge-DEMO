import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Assignment,
  type Learner,
  assignTemplate,
  createLearner,
  finishAssignment,
  getAssignment,
  listAssignments,
  listLearners,
  listTemplates,
  overrideResponse,
  regenerateLink,
  stopAssignment,
} from '../api/assessment';

const statusColor: Record<string, string> = {
  pending: 'default',
  in_progress: 'blue',
  submitted: 'orange',
  graded: 'green',
  stopped: 'red',
};

const statusLabel: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  submitted: '已提交',
  graded: '已完成',
  stopped: '已停止',
};

function copyText(text: string) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => message.success('已复制'),
      () => message.error('复制失败'),
    );
  } else {
    message.warning('当前浏览器不支持自动复制，请手动复制：' + text);
  }
}

export default function Assignments() {
  const qc = useQueryClient();
  const listQuery = useQuery({ queryKey: ['assignments'], queryFn: () => listAssignments() });
  const tplQuery = useQuery({ queryKey: ['assessment-templates'], queryFn: listTemplates });
  const learnerQuery = useQuery({ queryKey: ['learners'], queryFn: listLearners });

  const [assignOpen, setAssignOpen] = useState(false);
  const [newLearnerOpen, setNewLearnerOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const [form] = Form.useForm();
  const [newLearnerForm] = Form.useForm();

  const assignMut = useMutation({
    mutationFn: assignTemplate,
    onSuccess: (items) => {
      message.success(`已分配 ${items.length} 份`);
      setAssignOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '分配失败'),
  });

  const newLearnerMut = useMutation({
    mutationFn: createLearner,
    onSuccess: () => {
      message.success('已创建学员');
      setNewLearnerOpen(false);
      newLearnerForm.resetFields();
      qc.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '创建失败'),
  });

  const stopMut = useMutation({
    mutationFn: stopAssignment,
    onSuccess: () => {
      message.success('已停止考核');
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '停止失败'),
  });

  const finishMut = useMutation({
    mutationFn: finishAssignment,
    onSuccess: () => {
      message.success('已结束并结算考核');
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '结束失败'),
  });

  const buildFullLink = (share_url: string) => {
    const learnerBase = (import.meta as any).env?.VITE_LEARNER_BASE_URL || window.location.origin.replace(/:\d+$/, ':5173');
    if (share_url.startsWith('http')) return share_url;
    return learnerBase.replace(/\/$/, '') + share_url;
  };
  const selectedTemplateId = Form.useWatch('template_id', form);
  const selectedDueAt = Form.useWatch('due_at', form);
  const selectedTemplate = (tplQuery.data || []).find((t) => t.id === selectedTemplateId);
  const selectedIsOral = selectedTemplate?.mode === 'ai_oral';
  const selectedKpIds = selectedTemplate?.scope?.kp_ids || [];
  const dueAtLooksInvalid = !!selectedDueAt && Number.isNaN(Date.parse(String(selectedDueAt)));

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        title="考核任务分配"
        extra={
          <Space>
            <Button onClick={() => setNewLearnerOpen(true)}>+ 新建学员</Button>
            <Button type="primary" onClick={() => setAssignOpen(true)}>
              分配考核
            </Button>
          </Space>
        }
      >
        <Table<Assignment>
          rowKey="id"
          loading={listQuery.isLoading}
          dataSource={listQuery.data || []}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 60 },
            { title: '学员', dataIndex: 'learner_name', width: 120 },
            {
              title: '模板',
              dataIndex: 'template_id',
              width: 220,
              render: (tid: number) => {
                const t = (tplQuery.data || []).find((x) => x.id === tid);
                return t ? t.title : `#${tid}`;
              },
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (s: string) => <Tag color={statusColor[s] || 'default'}>{statusLabel[s] || s}</Tag>,
            },
            {
              title: '分数',
              dataIndex: 'score',
              width: 90,
              render: (v: number | null) => (v == null ? '-' : v.toFixed(1)),
            },
            {
              title: '截止',
              dataIndex: 'due_at',
              width: 150,
              render: (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '-'),
            },
            {
              title: '操作',
              render: (_: any, r: Assignment) => {
                const canStop = !['graded', 'stopped'].includes(r.status);
                const canFinish = !['graded', 'stopped'].includes(r.status);
                return (
                  <Space wrap>
                    <Button size="small" onClick={() => copyText(buildFullLink(r.share_url))}>
                      复制链接
                    </Button>
                    <Button size="small" onClick={() => setDetailId(r.id)}>
                      详情
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        Modal.confirm({
                          title: '催办：重置链接？',
                          content: '会重新生成 token、清空作答记录、状态回到 pending。',
                          onOk: () =>
                            regenerateLink(r.id).then((a) => {
                              copyText(buildFullLink(a.share_url));
                              qc.invalidateQueries({ queryKey: ['assignments'] });
                            }),
                        })
                      }
                    >
                      催办
                    </Button>
                    {canStop && (
                      <Button
                        size="small"
                        danger
                        loading={stopMut.isPending}
                        onClick={() =>
                          Modal.confirm({
                            title: '停止这份考核？',
                            content: '停止后学员链接不能继续作答；如需重新开放，可使用催办重置链接。',
                            okText: '停止考核',
                            okButtonProps: { danger: true },
                            onOk: () => stopMut.mutateAsync(r.id),
                          })
                        }
                      >
                        停止
                      </Button>
                    )}
                    {canFinish && (
                      <Button
                        size="small"
                        loading={finishMut.isPending}
                        onClick={() =>
                          Modal.confirm({
                            title: '结束并结算这份考核？',
                            content: '系统会按当前已有答题记录计算分数；未作答则记为 0 分。',
                            okText: '结束考核',
                            onOk: () => finishMut.mutateAsync(r.id),
                          })
                        }
                      >
                        结束
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      {/* 分配弹窗 */}
      <Modal
        title="分配考核任务"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={assignMut.isPending}
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) =>
            assignMut.mutate({
              template_id: v.template_id,
              learner_ids: v.learner_ids,
              due_at: v.due_at || null,
            })
          }
        >
          <Form.Item name="template_id" label="选择考核模板" rules={[{ required: true }]}>
            <Select
              options={(tplQuery.data || []).map((t) => ({
                value: t.id,
                label: `${t.title} · ${t.mode === 'bank' ? '题库' : 'AI主考'}`,
              }))}
              placeholder="选一个模板"
            />
          </Form.Item>
          {selectedTemplate && (
            <Alert
              type={selectedIsOral && selectedKpIds.length === 0 ? 'warning' : dueAtLooksInvalid ? 'error' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              message={selectedIsOral ? 'AI 主考任务质量检查' : '题库任务质量检查'}
              description={
                selectedIsOral
                  ? `约 ${selectedTemplate.num_questions} 轮 · 覆盖 ${selectedKpIds.length} 个 KP。学员将逐轮作答，每轮即时评分，交卷后生成综合评价。${selectedKpIds.length === 0 ? ' 当前模板没有范围 KP，建议先返回模板编辑页补充。' : ''}${dueAtLooksInvalid ? ' 截止时间格式可能不合法，请使用 ISO 格式。' : ''}`
                  : `${selectedTemplate.num_questions} 题 · 覆盖 ${selectedKpIds.length} 个 KP。${dueAtLooksInvalid ? ' 截止时间格式可能不合法，请使用 ISO 格式。' : ''}`
              }
            />
          )}
          <Form.Item name="learner_ids" label="分配给学员" rules={[{ required: true }]}>
            <Select<Learner['id'][]>
              mode="multiple"
              options={(learnerQuery.data || []).map((l) => ({
                value: l.id,
                label: `${l.name}${l.dept ? ` · ${l.dept}` : ''}`,
              }))}
              placeholder="可多选"
            />
          </Form.Item>
          <Form.Item name="due_at" label="截止时间（可选，ISO 格式）">
            <Input placeholder="例如 2026-06-30T18:00:00" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建学员弹窗 */}
      <Modal
        title="新建学员"
        open={newLearnerOpen}
        onCancel={() => setNewLearnerOpen(false)}
        onOk={() => newLearnerForm.submit()}
        confirmLoading={newLearnerMut.isPending}
      >
        <Form form={newLearnerForm} layout="vertical" onFinish={(v) => newLearnerMut.mutate(v)}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="dept" label="部门">
            <Input />
          </Form.Item>
          <Form.Item name="external_ref" label="外部标识（工号/邮箱，可空）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情抽屉 */}
      <AssignmentDetailDrawer
        id={detailId}
        onClose={() => setDetailId(null)}
        buildFullLink={buildFullLink}
      />
    </Space>
  );
}

function AssignmentDetailDrawer({
  id,
  onClose,
  buildFullLink,
}: {
  id: number | null;
  onClose: () => void;
  buildFullLink: (s: string) => string;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['assignment-detail', id],
    queryFn: () => (id ? getAssignment(id) : Promise.resolve(null as any)),
    enabled: id != null,
  });
  const [editing, setEditing] = useState<{ responseId: number; score: number; comment: string } | null>(null);

  const overrideMut = useMutation({
    mutationFn: () =>
      overrideResponse(id!, {
        response_id: editing!.responseId,
        human_score: editing!.score,
        comment: editing!.comment,
      }),
    onSuccess: () => {
      message.success('已保存');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['assignment-detail', id] });
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '保存失败'),
  });

  return (
    <Drawer
      title={`考核详情 #${id ?? ''}`}
      open={id != null}
      onClose={onClose}
      width={720}
    >
      {detail.isLoading && '加载中…'}
      {detail.data && (
        <Space direction="vertical" size={16} style={{ display: 'flex' }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="学员">{detail.data.learner_name}</Descriptions.Item>
            <Descriptions.Item label="模板">{detail.data.template?.title}</Descriptions.Item>
            <Descriptions.Item label="模式">
              {detail.data.template?.mode === 'bank' ? '固定题库' : 'AI 主考'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColor[detail.data.status] || 'default'}>
                {statusLabel[detail.data.status] || detail.data.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="总分">
              {detail.data.score == null ? '-' : detail.data.score.toFixed(1)}
            </Descriptions.Item>
            <Descriptions.Item label="链接">
              <Typography.Link onClick={() => copyText(buildFullLink(detail.data.share_url))}>
                复制
              </Typography.Link>
            </Descriptions.Item>
          </Descriptions>

          {(detail.data.responses || []).map((r) => {
            const isEditing = editing?.responseId === r.id;
            const effectiveScore = r.human_score_override ?? r.ai_score;
            const isOral = detail.data.template?.mode === 'ai_oral';
            const kpTags = Array.isArray(r.ai_feedback?.kp_tags) ? r.ai_feedback.kp_tags : [];
            return (
              <Card
                key={r.id}
                size="small"
                title={isOral ? `第 ${r.turn_idx + 1} 轮 AI 主考` : `第 ${r.turn_idx + 1} 题`}
                extra={<Tag color={effectiveScore != null && effectiveScore >= 60 ? 'green' : 'orange'}>最终 {effectiveScore != null ? effectiveScore.toFixed(1) : '-'}</Tag>}
              >
                <div style={{ marginBottom: 6 }}>
                  <b>{isOral ? 'AI 提问：' : '题面：'}</b>
                  {r.question_text}
                </div>
                <div style={{ marginBottom: 6 }}>
                  <b>学员回答：</b>
                  <div style={{ whiteSpace: 'pre-wrap', color: '#444' }}>{r.answer_text}</div>
                </div>
                <Space wrap>
                  <Tag color="blue">AI {r.ai_score?.toFixed(1) ?? '-'}</Tag>
                  {r.human_score_override != null && <Tag color="green">人工 {r.human_score_override.toFixed(1)}</Tag>}
                  {kpTags.map((kid: any) => <Tag key={kid}>KP {kid}</Tag>)}
                </Space>
                {Array.isArray(r.ai_feedback?.rubric_breakdown) && r.ai_feedback.rubric_breakdown.length > 0 && (
                  <ul style={{ marginTop: 8, marginBottom: 8 }}>
                    {r.ai_feedback.rubric_breakdown.map((rb: any, i: number) => (
                      <li key={i}>
                        <Tag color={rb.status === 'hit' ? 'green' : rb.status === 'partial' ? 'gold' : 'red'}>
                          {rb.status}
                        </Tag>
                        {rb.point}
                        {rb.note ? ` — ${rb.note}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {r.ai_feedback?.comment && (
                  <div style={{ color: '#666', marginTop: 4 }}>评语：{r.ai_feedback.comment}</div>
                )}
                {Array.isArray(r.ai_feedback?.missing_points) && r.ai_feedback.missing_points.length > 0 && (
                  <div style={{ color: '#8c4a00', marginTop: 4 }}>
                    遗漏要点：{r.ai_feedback.missing_points.join('；')}
                  </div>
                )}

                <div style={{ marginTop: 8 }}>
                  {isEditing ? (
                    <Space>
                      <InputNumber
                        min={0}
                        max={100}
                        value={editing!.score}
                        onChange={(v) => setEditing((e) => (e ? { ...e, score: Number(v) || 0 } : e))}
                      />
                      <Input
                        placeholder="评语（可选）"
                        value={editing!.comment}
                        onChange={(e) =>
                          setEditing((s) => (s ? { ...s, comment: e.target.value } : s))
                        }
                        style={{ width: 240 }}
                      />
                      <Button type="primary" loading={overrideMut.isPending} onClick={() => overrideMut.mutate()}>
                        保存
                      </Button>
                      <Button onClick={() => setEditing(null)}>取消</Button>
                    </Space>
                  ) : (
                    <Button
                      size="small"
                      onClick={() =>
                        setEditing({
                          responseId: r.id,
                          score: r.human_score_override ?? r.ai_score ?? 0,
                          comment: r.human_comment || '',
                        })
                      }
                    >
                      人工改分
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </Space>
      )}
    </Drawer>
  );
}
