import { useRef, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createProduct, listProducts, patchProduct, uploadProductCover, type Product } from '../api/product';
import {
  deleteRole,
  generateRoles,
  listRoles,
  patchRole,
  setDefaultRole,
  type PracticeRole,
} from '../api/practiceRole';
import { bootstrapKps, reorganizeKps } from '../api/courseAi';

export default function Products() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['products'], queryFn: listProducts });
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidateAfterKpChange = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['kps'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['kp-map'] });
    qc.invalidateQueries({ queryKey: ['attention'] });
    qc.invalidateQueries({ queryKey: ['hr', 'overview'] });
    qc.invalidateQueries({ queryKey: ['hr', 'attention'] });
    qc.invalidateQueries({ queryKey: ['hr', 'items'] });
  };

  const doBootstrap = useMutation({
    mutationFn: (id: number) => bootstrapKps(id, 4),
    onSuccess: (r) => {
      const conflictMsg = r.conflicts?.length
        ? `（${r.conflicts.length} 条同名 KP 状态非 approved，已跳过）`
        : '';
      message.success(
        `已生成 ${r.new_kps} 新 KP / 复用 ${r.reused} / 新增 ${r.new_links} 绑定${conflictMsg}`,
      );
      invalidateAfterKpChange();
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const doReorganize = useMutation({
    mutationFn: (id: number) => reorganizeKps(id),
    onSuccess: (r) => {
      message.success(`已重组：${r.changed.length} / ${r.total} 个 KP 分类变更`);
      invalidateAfterKpChange();
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  return (
    <Card
      title="产品管理"
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          新建产品
        </Button>
      }
    >
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data || []}
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: 'Code', dataIndex: 'code', width: 140 },
          { title: '名称', dataIndex: 'name' },
          { title: '行业', dataIndex: 'industry', width: 120 },
          { title: '学员角色', dataIndex: 'student_role', width: 120 },
          { title: '客户称谓', dataIndex: 'customer_label', width: 100 },
          { title: 'KP 数', dataIndex: 'kp_count', width: 80 },
          { title: '文档数', dataIndex: 'doc_count', width: 80 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s}</Tag>,
          },
          {
            title: '操作',
            width: 240,
            render: (_: any, r: Product) => (
              <Space size="small">
                <a onClick={() => setEditing(r)}>编辑</a>
                <Tooltip title="无文档时基于产品元数据生成课程 KP">
                  <Popconfirm
                    title="冷启动课程 KP？"
                    description="AI 将基于产品元数据直接生成已审定 KP"
                    onConfirm={() => doBootstrap.mutate(r.id)}
                  >
                    <a>🪄 冷启动</a>
                  </Popconfirm>
                </Tooltip>
                <Tooltip title="对已 approved KP 重排 category">
                  <Popconfirm
                    title="AI 重组 KP 分类？"
                    onConfirm={() => doReorganize.mutate(r.id)}
                    disabled={(r.kp_count ?? 0) < 3}
                  >
                    <a style={{ opacity: (r.kp_count ?? 0) < 3 ? 0.4 : 1 }}>🔄 重组</a>
                  </Popconfirm>
                </Tooltip>
              </Space>
            ),
          },
        ]}
      />

      <ProductFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onOk={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['products'] });
        }}
      />
      <ProductFormModal
        product={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        onOk={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ['products'] });
        }}
      />
    </Card>
  );
}

function ProductFormModal({
  open,
  product,
  onClose,
  onOk,
}: {
  open: boolean;
  product?: Product | null;
  onClose: () => void;
  onOk: () => void;
}) {
  const [form] = Form.useForm();
  const isEdit = !!product;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (vals: any) => {
      if (isEdit) return patchProduct(product!.id, vals);
      return createProduct(vals);
    },
    onSuccess: () => {
      message.success(isEdit ? '已更新' : '已创建');
      onOk();
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  return (
    <Modal
      title={isEdit ? `编辑：${product?.name}` : '新建产品'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
      width={isEdit ? 760 : 520}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={product || { allow_experience_answer: true }}
        onFinish={(v) => save.mutate(v)}
      >
        {!isEdit && (
          <Form.Item label="Code（业务唯一码）" name="code" rules={[{ required: true }]}>
            <Input placeholder="如 zeekr007 / pax" />
          </Form.Item>
        )}
        <Form.Item label="名称" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="行业" name="industry">
          <Input placeholder="如 汽车销售 / 医药学术" />
        </Form.Item>
        <Form.Item label="学员角色" name="student_role">
          <Input placeholder="如 销售顾问 / 医药代表" />
        </Form.Item>
        <Form.Item label="客户称谓" name="customer_label">
          <Input placeholder="如 客户 / 医生" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          label="产品 / 行业特征简介（AI 经验回答的背景）"
          name="features_brief"
          tooltip="当 AI 知识问答在知识库里没找到相关材料时，会基于这段背景 + 行业常识给出兜底回答。建议写清楚：产品定位、目标客群、行业惯例、销售场景。留空则该产品不会启用经验回答。"
        >
          <Input.TextArea rows={4} placeholder="例如：本产品定位中高端家庭用户，客户多为初为父母的 80/90 后；行业内常见痛点是… 销售话术通常会先建立信任…" />
        </Form.Item>
        <Form.Item
          label="允许经验回答"
          name="allow_experience_answer"
          valuePropName="checked"
          tooltip="关闭后，知识库未命中时仍走严格的「暂无官方资料」兜底，不会用 AI 经验回答。"
        >
          <Switch />
        </Form.Item>
      </Form>

      {isEdit && product && (
        <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>产品封面</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div
              style={{
                width: 120,
                height: 80,
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
              {coverPreview || product.cover_image_url ? (
                <img
                  src={coverPreview || `http://localhost:8000${product.cover_image_url}`}
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
                    message.success('封面上传成功');
                  } catch (err: any) {
                    message.error(err?.response?.data?.detail || '上传失败');
                  } finally {
                    setCoverUploading(false);
                    e.target.value = '';
                  }
                }}
              />
              <Button
                loading={coverUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {product.cover_image_url || coverPreview ? '替换封面' : '上传封面'}
              </Button>
              <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
                支持 jpg / png / webp，建议 16:9，上传后立即生效
              </div>
            </div>
          </div>
        </div>
      )}

      {isEdit && product && <RolesSection productId={product.id} />}
    </Modal>
  );
}

export function RolesSection({ productId }: { productId: number }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['practice-roles', productId],
    queryFn: () => listRoles(productId),
  });
  const [editingRole, setEditingRole] = useState<PracticeRole | null>(null);

  const gen = useMutation({
    mutationFn: () => generateRoles(productId),
    onSuccess: () => {
      message.success('已重新生成角色');
      qc.invalidateQueries({ queryKey: ['practice-roles', productId] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const setDefault = useMutation({
    mutationFn: (id: number) => setDefaultRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['practice-roles', productId] }),
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => deleteRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['practice-roles', productId] }),
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  const roles = q.data || [];

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <strong>演练角色（{roles.length}）</strong>
        <Button size="small" type="primary" loading={gen.isPending} onClick={() => gen.mutate()}>
          🪄 AI 生成角色
        </Button>
      </div>

      {roles.length === 0 && !q.isLoading && (
        <div style={{ color: '#999' }}>暂无角色。点击「AI 生成角色」根据产品资料自动配置。</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {roles.map((r) => (
          <div
            key={r.id}
            style={{
              border: '1px solid #e5e5e5',
              borderRadius: 6,
              padding: 10,
              background: r.is_default ? '#fffbe6' : '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 16, marginRight: 4 }}>{r.emoji || '🙂'}</span>
                <strong>{r.name || '(未命名)'}</strong>{' '}
                {r.is_default && <Tag color="gold">默认</Tag>}
                <Tag>{r.source}</Tag>
              </div>
              <a onClick={() => setEditingRole(r)}>编辑</a>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {r.age} 岁 · {r.job || '—'} · {r.city || '—'}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{r.tagline}</div>
            <Space size={4} style={{ marginTop: 6 }}>
              {!r.is_default && (
                <Button size="small" onClick={() => setDefault.mutate(r.id)}>
                  设为默认
                </Button>
              )}
              <Popconfirm title="删除该角色？" onConfirm={() => del.mutate(r.id)}>
                <Button size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </div>
        ))}
      </div>

      <RoleEditDrawer
        role={editingRole}
        onClose={() => setEditingRole(null)}
        onSaved={() => {
          setEditingRole(null);
          qc.invalidateQueries({ queryKey: ['practice-roles', productId] });
        }}
      />
    </div>
  );
}

function RoleEditDrawer({
  role,
  onClose,
  onSaved,
}: {
  role: PracticeRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const save = useMutation({
    mutationFn: async (vals: any) => patchRole(role!.id, vals),
    onSuccess: () => {
      message.success('已保存');
      onSaved();
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  return (
    <Drawer
      title={role ? `编辑角色：${role.name}` : ''}
      open={!!role}
      onClose={onClose}
      width={520}
      destroyOnClose
      extra={
        <Button type="primary" onClick={() => form.submit()} loading={save.isPending}>
          保存
        </Button>
      }
    >
      {role && (
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: role.name,
            age: role.age,
            job: role.job,
            city: role.city,
            family: role.family,
            budget: role.budget,
            tagline: role.tagline,
            vibe: role.vibe,
            emoji: role.emoji,
            motivation: role.motivation,
            opener: role.opener,
            promptSeed: role.promptSeed,
            personality: (role.personality || []).join('、'),
            concerns: (role.concerns || []).join('、'),
          }}
          onFinish={(v) => {
            const body: any = { ...v };
            body.personality =
              typeof v.personality === 'string'
                ? v.personality
                    .split(/[、,，]/)
                    .map((x: string) => x.trim())
                    .filter(Boolean)
                : v.personality;
            body.concerns =
              typeof v.concerns === 'string'
                ? v.concerns
                    .split(/[、,，]/)
                    .map((x: string) => x.trim())
                    .filter(Boolean)
                : v.concerns;
            save.mutate(body);
          }}
        >
          <Form.Item label="姓名" name="name"><Input /></Form.Item>
          <Form.Item label="年龄" name="age"><InputNumber min={16} max={99} /></Form.Item>
          <Form.Item label="职业" name="job"><Input /></Form.Item>
          <Form.Item label="城市" name="city"><Input /></Form.Item>
          <Form.Item label="家庭" name="family"><Input /></Form.Item>
          <Form.Item label="预算" name="budget"><Input /></Form.Item>
          <Form.Item label="一句话标签" name="tagline"><Input /></Form.Item>
          <Form.Item label="氛围 vibe" name="vibe"><Input /></Form.Item>
          <Form.Item label="emoji" name="emoji"><Input /></Form.Item>
          <Form.Item label="动机 motivation" name="motivation"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="开场白 opener" name="opener"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="性格 personality（顿号分隔）" name="personality"><Input /></Form.Item>
          <Form.Item label="顾虑 concerns（顿号分隔）" name="concerns"><Input /></Form.Item>
          <Form.Item label="对话系统提示 promptSeed" name="promptSeed">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      )}
    </Drawer>
  );
}
