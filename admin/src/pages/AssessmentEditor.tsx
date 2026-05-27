import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  aiGenerateQuestions,
  getTemplate,
  patchTemplate,
  type AssessmentQuestion,
} from '../api/assessment';
import { listKps } from '../api/kp';

export default function AssessmentEditor() {
  const { id } = useParams<{ id: string }>();
  const tplId = Number(id);
  const nav = useNavigate();
  const qc = useQueryClient();

  const tplQuery = useQuery({ queryKey: ['assessment-template', tplId], queryFn: () => getTemplate(tplId) });
  const kpsQuery = useQuery({ queryKey: ['kps-all'], queryFn: () => listKps({ limit: 500 }) });

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'bank' | 'ai_oral'>('bank');
  const [passScore, setPassScore] = useState(60);
  const [numQuestions, setNumQuestions] = useState(5);
  const [scopeKpIds, setScopeKpIds] = useState<number[]>([]);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiNum, setAiNum] = useState(5);
  const [aiDiff, setAiDiff] = useState<'easy' | 'normal' | 'hard'>('normal');

  useEffect(() => {
    if (!tplQuery.data) return;
    const t = tplQuery.data;
    setTitle(t.title);
    setMode(t.mode);
    setPassScore(t.pass_score);
    setNumQuestions(t.num_questions);
    setScopeKpIds(t.scope?.kp_ids || []);
    setQuestions(t.question_set || []);
  }, [tplQuery.data]);

  const kpNameMap = useMemo(() => {
    const m = new Map<number, string>();
    (kpsQuery.data || []).forEach((k: any) => m.set(k.id, k.name));
    return m;
  }, [kpsQuery.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      patchTemplate(tplId, {
        title,
        mode,
        pass_score: passScore,
        num_questions: numQuestions,
        scope: { kp_ids: scopeKpIds, product_ids: [] },
        question_set: questions,
      } as any),
    onSuccess: () => {
      message.success('已保存');
      qc.invalidateQueries({ queryKey: ['assessment-template', tplId] });
      qc.invalidateQueries({ queryKey: ['assessment-templates'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '保存失败'),
  });

  const aiMut = useMutation({
    mutationFn: () => aiGenerateQuestions(tplId, { num: aiNum, difficulty: aiDiff }),
    onSuccess: (drafts) => {
      const startIdx = questions.length;
      const appended = drafts.map((d: any, i: number) => ({
        idx: startIdx + i,
        text: d.text,
        rubric: d.rubric || [],
        ref_chunk_ids: d.ref_chunk_ids || [],
        ref_kp_ids: d.ref_kp_ids || [],
      }));
      setQuestions((q) => [...q, ...appended]);
      setAiOpen(false);
      message.success(`AI 草拟了 ${drafts.length} 道考核模板题，可继续手动修改后保存`);
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || 'AI 生成失败'),
  });

  if (tplQuery.isLoading) return <Spin />;
  if (!tplQuery.data) return <Alert type="error" message="模板不存在" />;

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        title={`编辑：${tplQuery.data.title}`}
        extra={
          <Space>
            <Button onClick={() => nav('/hr/assessments')}>返回</Button>
            <Button type="primary" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form layout="vertical">
          <Form.Item label="标题">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Form.Item>
          <Space size={24}>
            <Form.Item label="模式">
              <Select
                value={mode}
                style={{ width: 200 }}
                onChange={setMode}
                options={[
                  { value: 'bank', label: '固定题库' },
                  { value: 'ai_oral', label: 'AI 主考' },
                ]}
              />
            </Form.Item>
            <Form.Item label="题数 / 轮数">
              <InputNumber min={1} max={30} value={numQuestions} onChange={(v) => setNumQuestions(Number(v) || 1)} />
            </Form.Item>
            <Form.Item label="及格分">
              <InputNumber min={0} max={100} value={passScore} onChange={(v) => setPassScore(Number(v) || 0)} />
            </Form.Item>
          </Space>
          {mode === 'ai_oral' && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="AI 主考会在学员作答时逐轮动态出题"
              description="题目来自下方考核范围 KP。素材充足时会围绕知识点和 chunks 追问；缺少 chunks 的 KP 会降级为基础题，仍可评分，但题目贴合度会下降。建议先确认 KP 素材质量，再分配给学员。"
            />
          )}
          <Form.Item
            label="考核范围 KP（学员将围绕这些知识点作答）"
            help="带 chunks 的 KP 出题质量最好；0 chunks 只能用 KP 定义兜底，AI 容易跑题。"
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              value={scopeKpIds}
              onChange={setScopeKpIds}
              placeholder="选择 KP（可多选）"
              loading={kpsQuery.isLoading}
              options={(kpsQuery.data || []).map((k: any) => {
                const cc = typeof k.chunk_count === 'number' ? k.chunk_count : null;
                const ccLabel = cc == null ? '' : cc > 0 ? ` · ${cc} chunks` : ' · ⚠ 0 chunks';
                return {
                  value: k.id,
                  label: `[${k.id}] ${k.name}${ccLabel}`,
                };
              })}
            />
            {scopeKpIds.length > 0 && (() => {
              const empties = (kpsQuery.data || [])
                .filter((k: any) => scopeKpIds.includes(k.id) && (k.chunk_count ?? 0) === 0);
              if (empties.length === 0) return null;
              return (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={`已选 ${empties.length} 个 KP 没有 chunks：${empties.map((k: any) => `[${k.id}] ${k.name}`).join('、')}`}
                  description="AI 会用 KP 定义作为兜底素材，但出题质量与学员评分都会下降。建议先去 KP 详情页挂上 chunks 再来。"
                />
              );
            })()}
          </Form.Item>
        </Form>
      </Card>

      {mode === 'bank' && (
        <Card
          title="考核模板题库"
          extra={
            <Space>
              <Button onClick={() => setAiOpen(true)} disabled={!scopeKpIds.length}>
                AI 草拟模板题
              </Button>
              <Button
                onClick={() =>
                  setQuestions((q) => [
                    ...q,
                    { idx: q.length, text: '', rubric: [], ref_chunk_ids: [], ref_kp_ids: [] },
                  ])
                }
              >
                + 手动加题
              </Button>
            </Space>
          }
        >
          {questions.length === 0 && (
            <Alert
              type="info"
              showIcon
              message="还没有考核模板题。先选好范围 KP，再点「AI 草拟模板题」生成草稿，或手动加题。"
            />
          )}
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            {questions.map((q, i) => (
              <Card key={i} size="small" type="inner" title={`第 ${i + 1} 题`}>
                <Form layout="vertical">
                  <Form.Item label="题面">
                    <Input.TextArea
                      rows={2}
                      value={q.text}
                      onChange={(e) =>
                        setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                      }
                    />
                  </Form.Item>
                  <Form.Item label="评分要点（rubric，每行一条）">
                    <Input.TextArea
                      rows={3}
                      value={(q.rubric || []).join('\n')}
                      onChange={(e) =>
                        setQuestions((qs) =>
                          qs.map((x, j) =>
                            j === i
                              ? { ...x, rubric: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }
                              : x,
                          ),
                        )
                      }
                    />
                  </Form.Item>
                  <Space wrap>
                    {(q.ref_kp_ids || []).map((kid) => (
                      <Tag key={kid}>KP {kid} {kpNameMap.get(kid) || ''}</Tag>
                    ))}
                  </Space>
                  <div style={{ marginTop: 8 }}>
                    <Button danger size="small" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i).map((x, j) => ({ ...x, idx: j })))}>
                      删除
                    </Button>
                  </div>
                </Form>
              </Card>
            ))}
          </Space>
        </Card>
      )}

      {mode === 'ai_oral' && (
        <Card title="AI 主考出题说明">
          <Space direction="vertical" size={10} style={{ display: 'flex' }}>
            <Alert
              type="success"
              showIcon
              message={`学员端将看到约 ${numQuestions} 轮动态问答`}
              description="每轮提交后即时评分，全部完成后生成综合评价和按 KP 的表现汇总。后台无需预生成题库。"
            />
            {scopeKpIds.length === 0 && (
              <Alert
                type="warning"
                showIcon
                message="还没有选择考核范围 KP"
                description="AI 主考需要范围 KP 才能稳定出题。保存前请至少选择一个 KP。"
              />
            )}
          </Space>
        </Card>
      )}

      <Modal
        title="AI 草拟考核模板题目"
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        onOk={() => aiMut.mutate()}
        confirmLoading={aiMut.isPending}
      >
        <Alert
          type="info"
          showIcon
          message="基于已选范围 KP 的知识素材生成考核模板题库草稿，不会写入 KP 详情页的学习闭环考题。生成后会追加到现有题库末尾，你可以继续修改。"
          style={{ marginBottom: 12 }}
        />
        <Space>
          <Form.Item label="数量">
            <InputNumber min={1} max={15} value={aiNum} onChange={(v) => setAiNum(Number(v) || 1)} />
          </Form.Item>
          <Form.Item label="难度">
            <Select
              value={aiDiff}
              style={{ width: 120 }}
              onChange={setAiDiff}
              options={[
                { value: 'easy', label: '基础' },
                { value: 'normal', label: '一般' },
                { value: 'hard', label: '进阶' },
              ]}
            />
          </Form.Item>
        </Space>
      </Modal>
    </Space>
  );
}
