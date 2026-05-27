import { useEffect, useState } from 'react';
import {
  Alert, Card, Descriptions, List, Select, Tag, Spin, Space, Button, message, Popconfirm,
  Radio, Input, Divider, Modal,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { enrichKp, generateKpExam, getKp, patchKpCard, putKpExam, type KpCard } from '../api/kp';
import { getKpDetail } from '../api/dashboard';
import { approveKp, listKpChunks, patchKp, unlinkChunk } from '../api/kp';
import { bindKpProducts } from '../api/product';
import { useActiveProduct } from '../context/ActiveProduct';

const statusColor: Record<string, string> = {
  draft: 'gold',
  approved: 'green',
  archived: 'default',
};

const enrichStatusColor: Record<string, string> = {
  pending: 'default',
  done: 'green',
  failed: 'red',
};

const examStatusColor: Record<string, string> = {
  pending: 'default',
  generating: 'processing',
  ready: 'green',
  error: 'red',
};

const DEFAULT_CARD: KpCard = {
  tier: 'detail',
  spec: '',
  customerVoice: '',
  sources: [],
  appliesTo: [],
  notApplicable: [],
  rebuttals: [],
  sales: '',
  triggerQuestions: [],
  aliases: [],
  scenario: '',
  retrievalIndexedAt: null,
  retrievalIndexStatus: 'pending',
  retrievalIndexError: '',
  enrichStatus: 'pending',
  enrichError: '',
  enrichedAt: null,
  examQuestion: '',
  examRubric: [],
  examStatus: 'pending',
  examGeneratedAt: null,
  examError: '',
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
  const [card, setCard] = useState<KpCard>(DEFAULT_CARD);

  // 当 KP 详情加载后，把当前绑定的产品 ids 填入 Select
  useEffect(() => {
    if (kpRaw.data?.products) {
      setSelectedProducts(kpRaw.data.products.map((p: any) => p.id));
    }
    if (kpRaw.data?.card) {
      setCard(kpRaw.data.card);
    }
  }, [kpRaw.data]);

  const enrichMut = useMutation({
    mutationFn: () => enrichKp(kpId),
    onSuccess: (res) => {
      if (res?.ok) {
        if (res.reindex_warning) {
          // enrich 成功但 reindex 失败：召回索引未更新，必须警告而非默默 success
          message.warning(`enrich 成功，但召回索引同步失败：${res.reindex_warning}`);
        } else {
          message.success('已重新 enrich');
        }
      } else {
        message.error(`enrich 失败：${res?.error || '未知错误'}`);
      }
      qc.invalidateQueries({ queryKey: ['kp-raw', kpId] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  const [examQuestion, setExamQuestion] = useState('');
  const [examRubric, setExamRubric] = useState<string[]>([]);

  useEffect(() => {
    if (kpRaw.data?.card) {
      setExamQuestion(kpRaw.data.card.examQuestion || '');
      setExamRubric(kpRaw.data.card.examRubric || []);
    }
  }, [kpRaw.data]);

  const generateExamMut = useMutation({
    mutationFn: () => generateKpExam(kpId),
    onSuccess: (res) => {
      if (res.exam_status === 'ready') {
        message.success('考题已生成');
        setExamQuestion(res.exam_question);
        setExamRubric(res.exam_rubric || []);
      } else {
        message.error(`生成失败：${res.exam_error || '未知错误'}`);
      }
      qc.invalidateQueries({ queryKey: ['kp-raw', kpId] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  const saveExamMut = useMutation({
    mutationFn: () =>
      putKpExam(kpId, { exam_question: examQuestion, exam_rubric: examRubric }),
    onSuccess: (res) => {
      message.success('考题已保存');
      setExamQuestion(res.exam_question);
      setExamRubric(res.exam_rubric || []);
      qc.invalidateQueries({ queryKey: ['kp-raw', kpId] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  function confirmGenerateExam() {
    const hasExistingExam = Boolean((examQuestion || '').trim());
    if (!hasExistingExam) {
      generateExamMut.mutate();
      return;
    }
    Modal.confirm({
      title: '重新生成学习闭环考题？',
      content: '当前已有题干或人工编辑内容。重新生成会覆盖题干和评分要点。',
      okText: '重新生成',
      cancelText: '取消',
      onOk: () => generateExamMut.mutate(),
    });
  }

  const saveCardMut = useMutation({
    mutationFn: () =>
      patchKpCard(kpId, {
        tier: card.tier,
        spec: card.spec,
        customer_voice: card.customerVoice,
        sources: card.sources,
        applies_to: card.appliesTo,
        not_applicable: card.notApplicable,
        rebuttals: card.rebuttals,
        sales: card.sales,
        trigger_questions: card.triggerQuestions,
        aliases: card.aliases,
        scenario: card.scenario,
      }),
    onSuccess: (data) => {
      if (data?.reindexWarning) {
        message.warning(`卡片已保存，但召回索引同步失败：${data.reindexWarning}`);
      } else {
        message.success('卡片已保存');
      }
      setCard(data);
      qc.invalidateQueries({ queryKey: ['kp-raw', kpId] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

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
    onSuccess: (res) => {
      if (res?.reindex_warning) {
        message.warning(`已通过，但召回索引同步失败：${res.reindex_warning}`);
      } else {
        message.success('已通过');
      }
      qc.invalidateQueries({ queryKey: ['kp-detail'] });
      qc.invalidateQueries({ queryKey: ['kp-raw', kpId] });
    },
  });
  const archive = useMutation({
    mutationFn: () => patchKp(kpId, { status: 'archived' }),
    onSuccess: (res) => {
      if (res?.reindex_warning) {
        message.warning(`已归档，但召回索引同步失败：${res.reindex_warning}`);
      } else {
        message.success('已归档');
      }
      qc.invalidateQueries({ queryKey: ['kp-detail'] });
      qc.invalidateQueries({ queryKey: ['kp-raw', kpId] });
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

      <Card
        title={
          <Space>
            卡片内容
            <Tag color={enrichStatusColor[card.enrichStatus] || 'default'}>
              enrich: {card.enrichStatus}
            </Tag>
            {card.enrichedAt && (
              <span style={{ color: '#888', fontSize: 12 }}>
                {new Date(card.enrichedAt).toLocaleString()}
              </span>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button
              loading={enrichMut.isPending}
              onClick={() => enrichMut.mutate()}
            >
              重新 enrich
            </Button>
            <Button
              type="primary"
              loading={saveCardMut.isPending}
              onClick={() => saveCardMut.mutate()}
            >
              保存
            </Button>
          </Space>
        }
        style={{ marginTop: 16 }}
      >
        {card.enrichStatus === 'failed' && card.enrichError && (
          <div style={{ marginBottom: 12, color: '#c00', fontSize: 12 }}>
            enrich 错误：{card.enrichError}
          </div>
        )}

        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="tier">
            <Radio.Group
              value={card.tier}
              onChange={(e) => setCard({ ...card, tier: e.target.value })}
            >
              <Radio value="core">重点 (core)</Radio>
              <Radio value="detail">普通 (detail)</Radio>
            </Radio.Group>
          </Descriptions.Item>
          <Descriptions.Item label="规格 spec">
            <Input.TextArea
              value={card.spec}
              onChange={(e) => setCard({ ...card, spec: e.target.value })}
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
          </Descriptions.Item>
          <Descriptions.Item label="客户感知 customerVoice">
            <Input.TextArea
              value={card.customerVoice}
              onChange={(e) => setCard({ ...card, customerVoice: e.target.value })}
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
          </Descriptions.Item>
          <Descriptions.Item label="销售技巧 sales">
            <Input.TextArea
              value={card.sales}
              onChange={(e) => setCard({ ...card, sales: e.target.value })}
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
          </Descriptions.Item>
          <Descriptions.Item label="信源 sources">
            <Space direction="vertical" style={{ width: '100%' }}>
              {card.sources.map((s, i) => (
                <Space key={i} style={{ width: '100%' }}>
                  <Select
                    style={{ width: 100 }}
                    value={s.type}
                    options={[
                      { value: '官方', label: '官方' },
                      { value: '实测', label: '实测' },
                      { value: '内部', label: '内部' },
                    ]}
                    onChange={(v) => {
                      const next = [...card.sources];
                      next[i] = { ...next[i], type: v };
                      setCard({ ...card, sources: next });
                    }}
                  />
                  <Input
                    style={{ width: 400 }}
                    value={s.label}
                    onChange={(e) => {
                      const next = [...card.sources];
                      next[i] = { ...next[i], label: e.target.value };
                      setCard({ ...card, sources: next });
                    }}
                  />
                  <Button
                    danger
                    size="small"
                    onClick={() =>
                      setCard({
                        ...card,
                        sources: card.sources.filter((_, j) => j !== i),
                      })
                    }
                  >
                    删除
                  </Button>
                </Space>
              ))}
              <Button
                size="small"
                onClick={() =>
                  setCard({
                    ...card,
                    sources: [...card.sources, { type: '内部', label: '' }],
                  })
                }
              >
                添加信源
              </Button>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="应用情境 scenario">
            <Input.TextArea
              value={card.scenario}
              placeholder="一段话描述什么样的客户/什么样的提问情境下应当用本 KP（≤80 字）"
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={(e) => setCard({ ...card, scenario: e.target.value })}
            />
          </Descriptions.Item>
          <Descriptions.Item label="典型问题 triggerQuestions">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={card.triggerQuestions}
              placeholder="学员可能问出的具体场景问题（如：客户问我们和特斯拉的区别该怎么答），回车或逗号分隔"
              tokenSeparators={[',', '，']}
              onChange={(v) => setCard({ ...card, triggerQuestions: v as string[] })}
            />
          </Descriptions.Item>
          <Descriptions.Item label="关键词别名 aliases">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={card.aliases}
              placeholder="同义词/品牌名/行话（如：竞品、对标、友商、特斯拉）"
              tokenSeparators={[',', '，']}
              onChange={(v) => setCard({ ...card, aliases: v as string[] })}
            />
          </Descriptions.Item>
          <Descriptions.Item label="召回索引状态 retrievalIndex">
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Space>
                <Tag
                  color={
                    card.retrievalIndexStatus === 'done'
                      ? 'green'
                      : card.retrievalIndexStatus === 'failed'
                        ? 'red'
                        : 'default'
                  }
                >
                  {card.retrievalIndexStatus}
                </Tag>
                <span style={{ color: card.retrievalIndexedAt ? undefined : '#999' }}>
                  {card.retrievalIndexedAt || '尚未索引 — 保存或重新富化后会自动同步'}
                </span>
              </Space>
              {card.retrievalIndexError && (
                <Alert
                  type="error"
                  showIcon
                  message="召回索引失败"
                  description={card.retrievalIndexError}
                  style={{ marginTop: 4 }}
                />
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="适用顾虑 appliesTo">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={card.appliesTo}
              tokenSeparators={[',', '，']}
              onChange={(v) => setCard({ ...card, appliesTo: v as string[] })}
            />
          </Descriptions.Item>
          <Descriptions.Item label="不必硬讲 notApplicable">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={card.notApplicable}
              tokenSeparators={[',', '，']}
              onChange={(v) => setCard({ ...card, notApplicable: v as string[] })}
            />
          </Descriptions.Item>
          <Descriptions.Item label="反驳应对 rebuttals">
            <Space direction="vertical" style={{ width: '100%' }}>
              {card.rebuttals.map((r, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid #f0f0f0',
                    padding: 8,
                    borderRadius: 4,
                    width: '100%',
                  }}
                >
                  <Input.TextArea
                    placeholder="客户质疑/问题 q"
                    value={r.q}
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    onChange={(e) => {
                      const next = [...card.rebuttals];
                      next[i] = { ...next[i], q: e.target.value };
                      setCard({ ...card, rebuttals: next });
                    }}
                  />
                  <Divider style={{ margin: '6px 0' }} />
                  <Input.TextArea
                    placeholder="应对思路 approach"
                    value={r.approach}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    onChange={(e) => {
                      const next = [...card.rebuttals];
                      next[i] = { ...next[i], approach: e.target.value };
                      setCard({ ...card, rebuttals: next });
                    }}
                  />
                  <div style={{ textAlign: 'right', marginTop: 4 }}>
                    <Button
                      danger
                      size="small"
                      onClick={() =>
                        setCard({
                          ...card,
                          rebuttals: card.rebuttals.filter((_, j) => j !== i),
                        })
                      }
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                size="small"
                onClick={() =>
                  setCard({
                    ...card,
                    rebuttals: [...card.rebuttals, { q: '', approach: '' }],
                  })
                }
              >
                添加反驳
              </Button>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title={
          <Space>
            学习闭环 · 考核题
            <Tag color={examStatusColor[card.examStatus] || 'default'}>
              {card.examStatus}
            </Tag>
            {card.examGeneratedAt && (
              <span style={{ color: '#888', fontSize: 12 }}>
                {new Date(card.examGeneratedAt).toLocaleString()}
              </span>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button
              loading={generateExamMut.isPending}
              onClick={confirmGenerateExam}
            >
              AI 重新生成
            </Button>
            <Button
              type="primary"
              loading={saveExamMut.isPending}
              onClick={() => saveExamMut.mutate()}
            >
              保存
            </Button>
          </Space>
        }
        style={{ marginTop: 16 }}
      >
        {card.examStatus === 'error' && card.examError && (
          <div style={{ marginBottom: 12, color: '#c00', fontSize: 12 }}>
            生成错误：{card.examError}
          </div>
        )}
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="题干 exam_question">
            <Input.TextArea
              value={examQuestion}
              onChange={(e) => setExamQuestion(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="一句话问题；学员闭卷答题时看到的就是这段"
            />
          </Descriptions.Item>
          <Descriptions.Item label="评分要点 exam_rubric">
            <Space direction="vertical" style={{ width: '100%' }}>
              {examRubric.map((r, i) => (
                <Space key={i} style={{ width: '100%' }}>
                  <Input
                    style={{ width: 520 }}
                    value={r}
                    placeholder={`要点 ${i + 1}`}
                    onChange={(e) => {
                      const next = [...examRubric];
                      next[i] = e.target.value;
                      setExamRubric(next);
                    }}
                  />
                  <Button
                    danger
                    size="small"
                    onClick={() => setExamRubric(examRubric.filter((_, j) => j !== i))}
                  >
                    删除
                  </Button>
                </Space>
              ))}
              <Button
                size="small"
                onClick={() => setExamRubric([...examRubric, ''])}
              >
                添加要点
              </Button>
              <div style={{ color: '#888', fontSize: 12 }}>
                每点对应学员答案应覆盖的核心内容；AI 评分按 hit/partial/miss 加权后归一到 100 分。
              </div>
            </Space>
          </Descriptions.Item>
        </Descriptions>
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
