import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addKpProduct,
  createProduct,
  deleteProduct,
  listProductCurriculum,
  listProducts,
  patchProduct,
  removeProductCurriculumKp,
  uploadProductCover,
  type Product,
} from '../api/product';
import { bulkApprove, bulkArchiveKps, createKp, generateKpExamBatch, listKps, type Kp } from '../api/kp';
import { createLearner, listLearners, type Learner } from '../api/assessment';
import {
  assignCourse,
  listCourseAssignments,
  revokeCourseAssignment,
  type CourseAssignment,
} from '../api/courseAssignment';
import { RolesSection } from './Products';

const statusColor: Record<string, string> = {
  active: 'green',
  archived: 'default',
  draft: 'gold',
  approved: 'green',
  revoked: 'red',
};

const examStatusLabel: Record<string, string> = {
  pending: '待生成',
  generating: '生成中',
  ready: '已就绪',
  error: '失败',
};

const examStatusColor: Record<string, string> = {
  pending: 'default',
  generating: 'processing',
  ready: 'green',
  error: 'red',
};

function getExamStatus(row: Kp | any) {
  return row.exam_status || row.card?.examStatus || 'pending';
}

function buildExamPrecheck(rows: Kp[]) {
  const generating = rows.filter((r) => getExamStatus(r) === 'generating');
  const statusBlocked = rows.filter((r) => r.status !== 'approved');
  const noChunks = rows.filter((r) => (r.chunk_count ?? 0) <= 0);
  const blockedIds = new Set([
    ...generating.map((r) => r.id),
    ...statusBlocked.map((r) => r.id),
    ...noChunks.map((r) => r.id),
  ]);
  const generateRows = rows.filter((r) => !blockedIds.has(r.id));
  const overwriteRows = generateRows.filter((r) => getExamStatus(r) === 'ready');
  return { generating, statusBlocked, noChunks, generateRows, overwriteRows };
}

function formatTime(s?: string | null) {
  return s ? s.slice(0, 16).replace('T', ' ') : '-';
}

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

function learnerLink(product: Product, learner?: CourseAssignment['learner']) {
  const account = learner?.external_ref;
  if (!account) return '';
  const base =
    (import.meta as any).env?.VITE_LEARNER_BASE_URL ||
    window.location.origin.replace(/:\d+$/, ':5173');
  const sp = new URLSearchParams({ account, product: product.code });
  return `${base.replace(/\/$/, '')}/?${sp.toString()}`;
}

function describeError(err: any): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (err?.message) return err.message;
  return '操作失败，请稍后重试';
}

function syncTail(rewritten: number): string {
  return rewritten > 0 ? `，搜索索引同步 ${rewritten} 个片段` : '';
}

export default function Courses() {
  const { id } = useParams<{ id?: string }>();
  if (id) return <CourseDetail productId={Number(id)} />;
  return <CourseList />;
}

function CourseList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const products = useQuery({ queryKey: ['products'], queryFn: listProducts });
  const assignments = useQuery({
    queryKey: ['course-assignments', 'active'],
    queryFn: () => listCourseAssignments({ status: 'active' }),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const assignedCount = useMemo(() => {
    const out = new Map<number, number>();
    (assignments.data || []).forEach((a) => {
      out.set(a.product_id, (out.get(a.product_id) || 0) + 1);
    });
    return out;
  }, [assignments.data]);
  const visibleProducts = useMemo(() => {
    const rows = products.data || [];
    if (statusFilter === 'all') return rows;
    return rows.filter((p) => p.status === statusFilter);
  }, [products.data, statusFilter]);

  const createMut = useMutation({
    mutationFn: createProduct,
    onSuccess: (p: Product) => {
      message.success('课程已创建');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['products'] });
      nav(`/hr/courses/${p.id}`);
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const updateMut = useMutation({
    mutationFn: (vals: Partial<Product>) => patchProduct(editing!.id, vals),
    onSuccess: () => {
      message.success('课程已保存');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      message.success('课程已删除');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  return (
    <Card
      title="课程管理"
      extra={
        <Space>
          <Select
            value={statusFilter}
            style={{ width: 130 }}
            onChange={setStatusFilter}
            options={[
              { value: 'active', label: '启用中' },
              { value: 'archived', label: '已删除' },
              { value: 'all', label: '全部' },
            ]}
          />
          <Button type="primary" onClick={() => setOpen(true)}>
            新建课程
          </Button>
        </Space>
      }
    >
      <Table<Product>
        rowKey="id"
        loading={products.isLoading}
        dataSource={visibleProducts}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: '课程编码', dataIndex: 'code', width: 150 },
          {
            title: '课程名称',
            dataIndex: 'name',
            render: (name: string, r) => <Link to={`/hr/courses/${r.id}`}>{name}</Link>,
          },
          { title: '行业/场景', dataIndex: 'industry', width: 140 },
          { title: '学员角色', dataIndex: 'student_role', width: 120 },
          { title: 'KP 数', dataIndex: 'kp_count', width: 80 },
          { title: '文档数', dataIndex: 'doc_count', width: 80 },
          {
            title: '已分发',
            width: 90,
            render: (_, r) => assignedCount.get(r.id) || 0,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
          },
          {
            title: '操作',
            width: 190,
            render: (_, r) => (
              <Space size="small">
                <Link to={`/hr/courses/${r.id}`}>管理</Link>
                <a onClick={() => setEditing(r)}>编辑</a>
                {r.status !== 'archived' && (
                  <Popconfirm
                    title="删除该课程？"
                    description="课程会被归档，学员端不再展示；历史分发、学习记录和 KP 编排会保留。"
                    onConfirm={() => deleteMut.mutate(r.id)}
                  >
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建课程"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        destroyOnHidden
      >
        <CourseForm
          form={form}
          initialValues={{ allow_experience_answer: true }}
          onFinish={(v) => createMut.mutate(v)}
          creating
        />
      </Modal>

      <Modal
        title={editing ? `编辑课程：${editing.name}` : '编辑课程'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        destroyOnHidden
      >
        {editing && (
          <CourseForm
            key={editing.id}
            form={editForm}
            initialValues={editing}
            onFinish={(v) => updateMut.mutate(v)}
          />
        )}
      </Modal>
    </Card>
  );
}

function CourseDetail({ productId }: { productId: number }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ['products'], queryFn: listProducts });
  const product = (products.data || []).find((p) => p.id === productId);
  const deleteMut = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      message.success('课程已删除');
      qc.invalidateQueries({ queryKey: ['products'] });
      nav('/hr/courses');
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  if (products.isLoading) return <Card>加载中…</Card>;
  if (!product) {
    return (
      <Card>
        <Alert type="warning" showIcon message="课程不存在或已删除" />
        <Button style={{ marginTop: 12 }} onClick={() => nav('/hr/courses')}>
          返回课程列表
        </Button>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Button onClick={() => nav('/hr/courses')}>返回</Button>
          <h2 style={{ margin: 0 }}>{product.name}</h2>
          <Tag color={statusColor[product.status] || 'default'}>{product.status}</Tag>
        </Space>
        <Space>
          <span style={{ color: '#666' }}>课程编码：{product.code}</span>
          {product.status !== 'archived' && (
            <Popconfirm
              title="删除该课程？"
              description="课程会被归档，学员端不再展示；历史分发、学习记录和 KP 编排会保留。"
              onConfirm={() => deleteMut.mutate(product.id)}
            >
              <Button danger loading={deleteMut.isPending}>
                删除课程
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <Card>
        <Tabs
          items={[
            {
              key: 'basic',
              label: '基本信息',
              children: <BasicTab product={product} />,
            },
            {
              key: 'kps',
              label: '知识点',
              children: <CourseKpsTab product={product} />,
            },
            {
              key: 'assignments',
              label: '课程分发',
              children: <DistributionTab product={product} />,
            },
            {
              key: 'roles',
              label: '演练角色',
              children: <RolesSection productId={product.id} />,
            },
          ]}
        />
      </Card>
    </Space>
  );
}

function CourseForm({
  form,
  initialValues,
  onFinish,
  creating,
}: {
  form: ReturnType<typeof Form.useForm>[0];
  initialValues?: any;
  onFinish: (v: any) => void;
  creating?: boolean;
}) {
  useEffect(() => {
    form.setFieldsValue(initialValues || {});
  }, [form, initialValues]);

  return (
    <Form form={form} layout="vertical" initialValues={initialValues} onFinish={onFinish}>
      <Form.Item
        label="课程编码"
        name="code"
        rules={[
          { required: true },
          { pattern: /^[A-Za-z0-9_-]{1,64}$/, message: '只能使用字母、数字、下划线或中划线，最长 64 位' },
        ]}
        tooltip="课程编码用于学员端链接参数，修改后旧链接里的课程编码会失效。"
      >
        <Input placeholder="如 zeekr007 / pax" />
      </Form.Item>
      <Form.Item label="课程名称" name="name" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item label="行业/场景" name="industry">
        <Input placeholder="如 汽车销售 / 医药学术" />
      </Form.Item>
      <Form.Item label="学员角色" name="student_role">
        <Input placeholder="如 销售顾问 / 医药代表" />
      </Form.Item>
      <Form.Item label="客户称谓" name="customer_label">
        <Input placeholder="如 客户 / 医生" />
      </Form.Item>
      <Form.Item label="课程描述" name="description">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item
        label="课程/行业特征简介（AI 经验回答背景）"
        name="features_brief"
      >
        <Input.TextArea rows={4} />
      </Form.Item>
      <Form.Item label="允许经验回答" name="allow_experience_answer" valuePropName="checked">
        <Switch />
      </Form.Item>
      {!creating && (
        <Form.Item label="KP 学习及格线" name="pass_score">
          <InputNumber min={0} max={100} precision={0} addonAfter="分" style={{ width: 180 }} />
        </Form.Item>
      )}
      {!creating && (
        <Form.Item label="发布状态" name="status">
          <Select
            options={[
              { value: 'active', label: 'active' },
              { value: 'archived', label: 'archived' },
            ]}
          />
        </Form.Item>
      )}
    </Form>
  );
}

function BasicTab({ product }: { product: Product }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (vals: any) => patchProduct(product.id, vals),
    onSuccess: () => {
      message.success('课程已保存');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  const currentCover = coverPreview || (product.cover_image_url ? `http://localhost:8000${product.cover_image_url}` : null);

  return (
    <div style={{ maxWidth: 760 }}>
      <CourseForm
        form={form}
        initialValues={product}
        onFinish={(v) => save.mutate(v)}
      />
      <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
        保存基本信息
      </Button>

      <div style={{ marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 20 }}>
        <div style={{ marginBottom: 10, fontWeight: 500 }}>课程封面</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div
            style={{
              width: 180,
              height: 60,
              borderRadius: 6,
              overflow: 'hidden',
              border: '1px dashed #d9d9d9',
              background: '#fafafa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {currentCover ? (
              <img
                src={currentCover}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                alt="封面预览"
              />
            ) : (
              <span style={{ color: '#bbb', fontSize: 12 }}>暂无封面</span>
            )}
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setCoverUploading(true);
                try {
                  const result = await uploadProductCover(product.id, file);
                  setCoverPreview(result.url);
                  message.success('封面上传成功，刷新学员端即可看到');
                  qc.invalidateQueries({ queryKey: ['products'] });
                } catch (err: any) {
                  message.error(err?.response?.data?.detail || '上传失败');
                } finally {
                  setCoverUploading(false);
                  e.target.value = '';
                }
              }}
            />
            <Button loading={coverUploading} onClick={() => fileInputRef.current?.click()}>
              {currentCover ? '替换封面' : '上传封面'}
            </Button>
            <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
              支持 jpg / png / webp · 建议 3:1 比例（如 900×300）· 上传后立即生效
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CourseKpsTab({ product }: { product: Product }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('approved');
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKpIds, setSelectedKpIds] = useState<number[]>([]);
  const [addProductId, setAddProductId] = useState<number | 'all'>('all');
  const [addStatus, setAddStatus] = useState<string>('all');
  const [selectedCourseKpIds, setSelectedCourseKpIds] = useState<number[]>([]);
  const [selectedCourseKps, setSelectedCourseKps] = useState<Kp[]>([]);
  const [examRows, setExamRows] = useState<Kp[]>([]);
  const [lastExamFailedIds, setLastExamFailedIds] = useState<number[]>([]);
  const [createForm] = Form.useForm();

  const kps = useQuery({
    queryKey: ['course-kps', product.id, status],
    queryFn: async () => {
      const items = await listProductCurriculum(product.id);
      const rows = items.map((item: any) => ({
        ...item,
        id: item.id || item.kp_id,
        exam_status: item.exam_status || item.card?.examStatus || 'pending',
        curriculum_status: 'active',
      })) as Kp[];
      return status === 'all' ? rows : rows.filter((row) => row.status === status);
    },
  });
  const addProducts = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
    enabled: addOpen,
  });
  const courseAllKps = useQuery({
    queryKey: ['course-kps', product.id, 'all-for-course-add-current'],
    queryFn: async () => {
      const items = await listProductCurriculum(product.id);
      return items.map((item: any) => ({ ...item, id: item.id || item.kp_id })) as Kp[];
    },
    enabled: addOpen,
  });
  const allKps = useQuery({
    queryKey: ['kps', 'all-for-course-add', addProductId],
    queryFn: () => (
      addProductId === 'all'
        ? listKps({ limit: 500 })
        : listKps({ limit: 500, product_id: addProductId })
    ),
    enabled: addOpen,
  });
  const currentIds = useMemo(
    () => new Set((courseAllKps.data || kps.data || []).map((k: any) => k.id)),
    [courseAllKps.data, kps.data],
  );
  const selectedCourseCount = selectedCourseKpIds.length;
  const selectedCourseBreakdown = useMemo(() => {
    const out = { draft: 0, approved: 0, archived: 0 };
    selectedCourseKps.forEach((r) => {
      const s = r.status as 'draft' | 'approved' | 'archived';
      if (s in out) out[s] += 1;
    });
    return out;
  }, [selectedCourseKps]);
  const courseExamStats = useMemo(() => {
    const rows = kps.data || [];
    return {
      ready: rows.filter((r) => getExamStatus(r) === 'ready').length,
      pending: rows.filter((r) => getExamStatus(r) === 'pending').length,
      error: rows.filter((r) => getExamStatus(r) === 'error').length,
      generating: rows.filter((r) => getExamStatus(r) === 'generating').length,
    };
  }, [kps.data]);
  const addSourceRows = useMemo(() => allKps.data || [], [allKps.data]);
  const addRowsBeforeStatus = useMemo(
    () => addSourceRows.filter((kp) => !currentIds.has(kp.id)),
    [addSourceRows, currentIds],
  );
  const addRows = useMemo(() => (
    addStatus === 'all'
      ? addRowsBeforeStatus
      : addRowsBeforeStatus.filter((kp) => kp.status === addStatus)
  ), [addRowsBeforeStatus, addStatus]);
  const addStats = useMemo(() => {
    const currentCount = addSourceRows.filter((kp) => currentIds.has(kp.id)).length;
    const recoverable = addProductId === product.id
      ? addRowsBeforeStatus.filter((kp) => kp.curriculum_status === 'removed').length
      : 0;
    return {
      sourceTotal: addSourceRows.length,
      currentCount,
      addable: addRows.length,
      recoverable,
    };
  }, [addRows.length, addRowsBeforeStatus, addSourceRows, addProductId, currentIds, product.id]);
  const examPrecheck = useMemo(() => buildExamPrecheck(examRows), [examRows]);
  const lastFailedRows = useMemo(() => {
    const byId = new Map((kps.data || []).map((r) => [r.id, r]));
    return lastExamFailedIds.map((id) => byId.get(id)).filter(Boolean) as Kp[];
  }, [kps.data, lastExamFailedIds]);

  function clearCourseSelection() {
    setSelectedCourseKpIds([]);
    setSelectedCourseKps([]);
  }

  function invalidateCourseKps() {
    qc.invalidateQueries({ queryKey: ['course-kps', product.id] });
    qc.invalidateQueries({ queryKey: ['kps'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  }

  useEffect(() => {
    clearCourseSelection();
  }, [status, product.id]);

  useEffect(() => {
    setSelectedKpIds([]);
  }, [addProductId, addStatus]);

  const addMut = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => addKpProduct(id, product.id)));
      return ids.length;
    },
    onSuccess: (count) => {
      message.success(`已加入本课程学习路径 ${count} 个知识点`);
      setAddOpen(false);
      setSelectedKpIds([]);
      invalidateCourseKps();
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const createMut = useMutation({
    mutationFn: async (vals: any) => {
      const kp = await createKp(vals);
      await addKpProduct(kp.id, product.id);
      return kp;
    },
    onSuccess: () => {
      message.success('知识点已创建并加入课程');
      setCreateOpen(false);
      createForm.resetFields();
      qc.invalidateQueries({ queryKey: ['course-kps', product.id] });
      qc.invalidateQueries({ queryKey: ['kps'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const unbind = useMutation({
    mutationFn: (kpId: number) => removeProductCurriculumKp(product.id, kpId),
    onSuccess: () => {
      message.success('已从课程移除');
      clearCourseSelection();
      qc.invalidateQueries({ queryKey: ['course-kps', product.id] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const bulkApproveMut = useMutation({ mutationFn: bulkApprove });
  const bulkArchiveMut = useMutation({ mutationFn: bulkArchiveKps });
  const examMut = useMutation({ mutationFn: (ids: number[]) => generateKpExamBatch(ids) });
  const bulkUnbindMut = useMutation({
    mutationFn: async (kpIds: number[]) => {
      await Promise.all(kpIds.map((id) => removeProductCurriculumKp(product.id, id)));
      return kpIds.length;
    },
  });

  const bulkApproveDisabled =
    selectedCourseCount === 0 ||
    selectedCourseBreakdown.draft === 0 ||
    selectedCourseBreakdown.archived > 0;
  const bulkArchiveDisabled =
    selectedCourseCount === 0 ||
    selectedCourseBreakdown.archived === selectedCourseCount;

  async function runBulkApprove() {
    const ids = [...selectedCourseKpIds];
    if (ids.length === 0) return;
    try {
      const res = await bulkApproveMut.mutateAsync(ids);
      const extras: string[] = [];
      if (res.skipped_already_approved.length > 0) {
        extras.push(`${res.skipped_already_approved.length} 个已发布`);
      }
      if (res.skipped_archived.length > 0) {
        extras.push(`${res.skipped_archived.length} 个已归档`);
      }
      if (res.missing_ids.length > 0) {
        extras.push(`${res.missing_ids.length} 个不存在`);
      }
      const tail = extras.length ? `（${extras.join('、')}已跳过）` : '';
      if (res.milvus_error) {
        message.warning(`已发布 ${res.approved} 个${tail}，但搜索索引同步失败：${res.milvus_error}`, 6);
      } else {
        message.success(`已发布 ${res.approved} 个知识点${tail}${syncTail(res.rewritten_chunks)}`);
      }
      clearCourseSelection();
      invalidateCourseKps();
    } catch (err) {
      message.error(describeError(err));
    }
  }

  async function runBulkArchive() {
    const ids = [...selectedCourseKpIds];
    if (ids.length === 0) return;
    try {
      const res = await bulkArchiveMut.mutateAsync(ids);
      const extras: string[] = [];
      if (res.skipped_already_archived.length > 0) {
        extras.push(`${res.skipped_already_archived.length} 个已归档`);
      }
      if (res.missing_ids.length > 0) {
        extras.push(`${res.missing_ids.length} 个不存在`);
      }
      const tail = extras.length ? `（${extras.join('、')}已跳过）` : '';
      if (res.milvus_error) {
        message.warning(`已归档 ${res.archived} 个${tail}，但搜索索引同步失败：${res.milvus_error}`, 6);
      } else {
        message.success(`已归档 ${res.archived} 个知识点${tail}${syncTail(res.milvus_rewritten_chunks)}`);
      }
      clearCourseSelection();
      invalidateCourseKps();
    } catch (err) {
      message.error(describeError(err));
    }
  }

  async function runBulkUnbind() {
    const ids = [...selectedCourseKpIds];
    if (ids.length === 0) return;
    try {
      const count = await bulkUnbindMut.mutateAsync(ids);
      message.success(`已从课程移除 ${count} 个知识点`);
      clearCourseSelection();
      qc.invalidateQueries({ queryKey: ['course-kps', product.id] });
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      message.error(describeError(err));
    }
  }

  function openExamBatch(rows: Kp[]) {
    setExamRows(rows);
  }

  async function runExamBatch() {
    const ids = examPrecheck.generateRows.map((r) => r.id);
    if (ids.length === 0) return;
    const toastKey = `course-exam-batch-${Date.now()}`;
    message.loading({ content: `正在生成 ${ids.length} 个学习闭环考题…`, key: toastKey, duration: 0 });
    try {
      const res = await examMut.mutateAsync(ids);
      const failedIds = res.failed.map((f) => f.kp_id);
      setLastExamFailedIds(failedIds);
      if (res.failed.length > 0) {
        message.warning({
          content: `考题生成完成：成功 ${res.succeeded.length} 个，失败 ${res.failed.length} 个`,
          key: toastKey,
          duration: 6,
        });
      } else {
        message.success({
          content: `考题生成完成：成功 ${res.succeeded.length} 个`,
          key: toastKey,
          duration: 3,
        });
      }
      setExamRows([]);
      clearCourseSelection();
      invalidateCourseKps();
    } catch (err) {
      message.error({ content: describeError(err), key: toastKey, duration: 5 });
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#666' }}>KP 全局状态</span>
        <Select
          value={status}
          style={{ width: 140 }}
          onChange={setStatus}
          options={[
            { value: 'approved', label: '已发布' },
            { value: 'draft', label: '草稿' },
            { value: 'archived', label: '已归档' },
            { value: 'all', label: '全部' },
          ]}
        />
        <Button onClick={() => setAddOpen(true)}>添加 / 恢复课程 KP</Button>
        <Button type="primary" onClick={() => setCreateOpen(true)}>新建知识点</Button>
        {lastFailedRows.length > 0 && (
          <Button onClick={() => openExamBatch(lastFailedRows)}>
            重试失败考题 {lastFailedRows.length}
          </Button>
        )}
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这里管理的是课程内 KP 编排；移除只解除本课程学习路径，不会删除知识条目或产品关联。"
        description={`学员端只展示本课程内 approved 状态的知识点。当前考题：已就绪 ${courseExamStats.ready} · 待生成 ${courseExamStats.pending} · 失败 ${courseExamStats.error} · 生成中 ${courseExamStats.generating}`}
      />
      {selectedCourseCount > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: '#e6f4ff',
            border: '1px solid #91caff',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>
            已选 <b>{selectedCourseCount}</b> 项
            <span style={{ color: '#666', marginLeft: 8 }}>
              （draft {selectedCourseBreakdown.draft} · approved {selectedCourseBreakdown.approved} · archived {selectedCourseBreakdown.archived}）
            </span>
          </span>
          <div style={{ flex: 1 }} />
          <Popconfirm
            title={`从本课程移除 ${selectedCourseCount} 个知识点？`}
            description="只解除与本课程学习路径的关联，不会删除知识点本身，也不会删除产品关联。"
            okText="移除"
            cancelText="取消"
            onConfirm={runBulkUnbind}
          >
            <Button size="small" danger loading={bulkUnbindMut.isPending}>
              批量移除课程
            </Button>
          </Popconfirm>
          <Button
            size="small"
            loading={examMut.isPending}
            onClick={() => openExamBatch(selectedCourseKps)}
          >
            批量生成学习闭环考题
          </Button>
          <span style={{ color: '#999' }}>全局状态操作</span>
          <Popconfirm
            title={`批量发布 ${selectedCourseBreakdown.draft} 个草稿知识点？`}
            description={
              selectedCourseBreakdown.approved > 0
                ? `选中含 ${selectedCourseBreakdown.approved} 个已发布，会自动跳过`
                : '发布是全局 KP 状态操作；本课程内 approved KP 会在学员端可见。'
            }
            okText="发布"
            cancelText="取消"
            disabled={bulkApproveDisabled}
            onConfirm={runBulkApprove}
          >
            <Button
              size="small"
              disabled={bulkApproveDisabled}
              loading={bulkApproveMut.isPending}
              title={selectedCourseBreakdown.archived > 0 ? '选中包含已归档知识点，无法批量发布' : ''}
            >
              批量发布
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`批量归档 ${selectedCourseCount} 个知识点？`}
            description={
              selectedCourseBreakdown.approved > 0
                ? `其中 ${selectedCourseBreakdown.approved} 个已发布；归档会影响所有课程、AI 问答检索和考核引用。`
                : '归档是全局 KP 状态操作，不是从本课程移除。'
            }
            okText="归档"
            cancelText="取消"
            disabled={bulkArchiveDisabled}
            onConfirm={runBulkArchive}
          >
            <Button size="small" disabled={bulkArchiveDisabled} loading={bulkArchiveMut.isPending}>
              批量归档
            </Button>
          </Popconfirm>
          <Button size="small" type="text" onClick={clearCourseSelection}>
            清空选择
          </Button>
        </div>
      )}
      <Table<Kp>
        rowKey="id"
        loading={kps.isLoading}
        dataSource={kps.data || []}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: '当前筛选下没有课程内 KP。可点击“添加 / 恢复课程 KP”从产品关联 KP 中加入。' }}
        rowSelection={{
          selectedRowKeys: selectedCourseKpIds,
          onChange: (keys, rows) => {
            setSelectedCourseKpIds(keys as number[]);
            setSelectedCourseKps(rows);
          },
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          {
            title: '名称',
            dataIndex: 'name',
            render: (name: string, r: any) => <Link to={`/hr/items/${r.id}`}>{name}</Link>,
          },
          { title: '分类', dataIndex: 'category', width: 140 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
          },
          {
            title: '考题',
            dataIndex: 'exam_status',
            width: 100,
            render: (s: string, r: any) => {
              const v = s || r.card?.examStatus || 'pending';
              return <Tag color={examStatusColor[v] || 'default'}>{examStatusLabel[v] || v}</Tag>;
            },
          },
          { title: 'chunks', dataIndex: 'chunk_count', width: 90 },
          {
            title: '定义',
            dataIndex: 'definition',
            render: (d: string) => <span style={{ color: '#666' }}>{(d || '').slice(0, 100)}</span>,
          },
          {
            title: '操作',
            width: 120,
            render: (_: any, r: any) => (
              <Popconfirm title="从本课程移除该知识点？" onConfirm={() => unbind.mutate(r.id)}>
                <Button size="small" danger>移除</Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal
        title="添加 / 恢复课程 KP"
        open={addOpen}
        onCancel={() => {
          setAddOpen(false);
          setSelectedKpIds([]);
        }}
        onOk={() => addMut.mutate(selectedKpIds)}
        okButtonProps={{ disabled: selectedKpIds.length === 0 }}
        confirmLoading={addMut.isPending}
        width={860}
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <span style={{ color: '#666' }}>来源产品</span>
          <Select
            value={addProductId}
            style={{ width: 260 }}
            loading={addProducts.isLoading}
            showSearch
            optionFilterProp="label"
            onChange={(v) => setAddProductId(v)}
            options={[
              { value: 'all', label: '全部产品' },
              ...(addProducts.data || []).map((p) => ({
                value: p.id,
                label: `${p.name}（${p.code}）`,
              })),
            ]}
          />
          <span style={{ color: '#666' }}>KP 状态</span>
          <Select
            value={addStatus}
            style={{ width: 140 }}
            onChange={setAddStatus}
            options={[
              { value: 'all', label: '全部' },
              { value: 'approved', label: 'approved' },
              { value: 'draft', label: 'draft' },
              { value: 'archived', label: 'archived' },
            ]}
          />
        </Space>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`来源产品 KP ${addStats.sourceTotal} · 已在本课程 ${addStats.currentCount} · 当前可添加 ${addStats.addable} · 已从本课程移除可恢复 ${addStats.recoverable}`}
          description="列表仅显示尚未在本课程学习路径中的 KP。添加会把它加入或恢复到本课程；不会影响其它课程。"
        />
        <Table<Kp>
          rowKey="id"
          size="small"
          loading={allKps.isLoading || courseAllKps.isLoading}
          dataSource={addRows}
          pagination={{ pageSize: 8 }}
          locale={{
            emptyText: addStats.sourceTotal === 0
              ? '来源产品下没有产品关联 KP。'
              : addRowsBeforeStatus.length === 0
                ? '来源产品的 KP 已全部在本课程内。'
                : '当前 KP 状态筛选下没有可添加项。',
          }}
          rowSelection={{
            selectedRowKeys: selectedKpIds,
            onChange: (keys) => setSelectedKpIds(keys as number[]),
          }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 70 },
            { title: '名称', dataIndex: 'name' },
            { title: '分类', dataIndex: 'category', width: 130 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
            },
            {
              title: '课程关系',
              dataIndex: 'curriculum_status',
              width: 130,
              render: (s: string) => {
                const label: Record<string, string> = {
                  active: '当前课程内',
                  removed: '已移除可恢复',
                  not_in_course: '尚未加入',
                };
                return <Tag>{label[s] || '可加入'}</Tag>;
              },
            },
          ]}
        />
      </Modal>

      <Modal
        title={`批量生成学习闭环考题 ${examRows.length} 个`}
        open={examRows.length > 0}
        onCancel={() => setExamRows([])}
        onOk={runExamBatch}
        okText="开始生成"
        cancelText="取消"
        confirmLoading={examMut.isPending}
        okButtonProps={{ disabled: examPrecheck.generateRows.length === 0 }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="这里生成的是 KP 学习闭环考题，不是考核模板题库。"
        />
        <Space direction="vertical" size={8} style={{ display: 'flex' }}>
          <div>可生成：<b>{examPrecheck.generateRows.length}</b> 个</div>
          <div>已有考题将覆盖：<b>{examPrecheck.overwriteRows.length}</b> 个</div>
          <div>缺少素材 chunks，暂不生成：<b>{examPrecheck.noChunks.length}</b> 个</div>
          <div>当前生成中，暂不重复触发：<b>{examPrecheck.generating.length}</b> 个</div>
          <div>非 approved 状态，暂不生成：<b>{examPrecheck.statusBlocked.length}</b> 个</div>
        </Space>
        {examPrecheck.overwriteRows.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="已就绪考题会被 AI 重新生成结果覆盖。"
          />
        )}
      </Modal>

      <Modal
        title="新建知识点"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={createForm} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="definition" label="定义">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function DistributionTab({ product }: { product: Product }) {
  const qc = useQueryClient();
  const assignments = useQuery({
    queryKey: ['course-assignments', product.id],
    queryFn: () => listCourseAssignments({ product_id: product.id }),
  });
  const learners = useQuery({ queryKey: ['learners'], queryFn: listLearners });
  const [assignOpen, setAssignOpen] = useState(false);
  const [learnerOpen, setLearnerOpen] = useState(false);
  const [assignForm] = Form.useForm();
  const [learnerForm] = Form.useForm();

  const activeLearnerIds = useMemo(
    () => new Set((assignments.data || [])
      .filter((a) => a.status === 'active')
      .map((a) => a.learner_id)),
    [assignments.data],
  );

  const assignMut = useMutation({
    mutationFn: (learnerIds: number[]) => assignCourse({ product_id: product.id, learner_ids: learnerIds }),
    onSuccess: (items) => {
      message.success(`已分发 ${items.length} 人`);
      setAssignOpen(false);
      assignForm.resetFields();
      qc.invalidateQueries({ queryKey: ['course-assignments', product.id] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const revokeMut = useMutation({
    mutationFn: revokeCourseAssignment,
    onSuccess: () => {
      message.success('已撤销分发');
      qc.invalidateQueries({ queryKey: ['course-assignments', product.id] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const createLearnerMut = useMutation({
    mutationFn: createLearner,
    onSuccess: () => {
      message.success('学员已创建');
      setLearnerOpen(false);
      learnerForm.resetFields();
      qc.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => setAssignOpen(true)}>
          分发课程
        </Button>
        <Button onClick={() => setLearnerOpen(true)}>新建学员</Button>
      </Space>
      <Table<CourseAssignment>
        rowKey="id"
        loading={assignments.isLoading}
        dataSource={assignments.data || []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          {
            title: '学员',
            render: (_, r) => r.learner?.name || `#${r.learner_id}`,
          },
          {
            title: '部门',
            render: (_, r) => r.learner?.dept || '-',
          },
          {
            title: '账号标识',
            render: (_, r) => r.learner?.external_ref || '-',
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
          },
          { title: '分发时间', dataIndex: 'assigned_at', width: 170, render: formatTime },
          { title: '撤销时间', dataIndex: 'revoked_at', width: 170, render: formatTime },
          {
            title: '操作',
            width: 190,
            render: (_, r) => {
              const link = learnerLink(product, r.learner);
              return (
                <Space>
                  <Button
                    size="small"
                    disabled={!link || r.status !== 'active'}
                    onClick={() => copyText(link)}
                  >
                    复制入口
                  </Button>
                  {r.status === 'active' && (
                    <Popconfirm title="撤销该学员的课程访问？" onConfirm={() => revokeMut.mutate(r.id)}>
                      <Button size="small" danger>撤销</Button>
                    </Popconfirm>
                  )}
                </Space>
              );
            },
          },
        ]}
      />

      <Modal
        title="分发课程"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={() => assignForm.submit()}
        confirmLoading={assignMut.isPending}
      >
        <Form
          form={assignForm}
          layout="vertical"
          onFinish={(v) => assignMut.mutate(v.learner_ids)}
        >
          <Form.Item name="learner_ids" label="选择学员" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              placeholder="可多选；已分发学员会自动过滤"
              options={(learners.data || [])
                .filter((l: Learner) => !activeLearnerIds.has(l.id))
                .map((l: Learner) => ({
                  value: l.id,
                  disabled: !l.external_ref,
                  label: `${l.name}${l.dept ? ` · ${l.dept}` : ''}${l.external_ref ? ` · ${l.external_ref}` : ' · 缺少账号标识'}`,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建学员"
        open={learnerOpen}
        onCancel={() => setLearnerOpen(false)}
        onOk={() => learnerForm.submit()}
        confirmLoading={createLearnerMut.isPending}
      >
        <Form form={learnerForm} layout="vertical" onFinish={(v) => createLearnerMut.mutate(v)}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="dept" label="部门">
            <Input />
          </Form.Item>
          <Form.Item
            name="external_ref"
            label="账号标识"
            tooltip="需与学员端 account.id 一致，例如 linsheng / lidaibiao。"
            rules={[{ required: true, message: '课程分发需要账号标识' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
