import { useState } from 'react';
import { Button, Card, Form, Input, Modal, Table, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createProduct, listProducts, patchProduct, type Product } from '../api/product';

export default function Products() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['products'], queryFn: listProducts });
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

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
            width: 80,
            render: (_: any, r: Product) => <a onClick={() => setEditing(r)}>编辑</a>,
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
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={product || {}}
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
      </Form>
    </Modal>
  );
}
