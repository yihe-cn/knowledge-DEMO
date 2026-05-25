import { useEffect, useState } from 'react';
import { Button, Card, Modal, Popconfirm, Select, Space, Table, Tag, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteDocument,
  getDocument,
  listDocChunks,
  listDocuments,
  reextract,
  uploadDocument,
} from '../api/kb';
import { backfillDocProduct } from '../api/product';
import { useActiveProduct } from '../context/ActiveProduct';

const statusColor: Record<string, string> = {
  pending: 'default',
  processing: 'blue',
  ready: 'green',
  failed: 'red',
};

export default function KbDocuments() {
  const qc = useQueryClient();
  const { productId, products } = useActiveProduct();
  const docs = useQuery({
    queryKey: ['docs', productId],
    queryFn: () => listDocuments({ limit: 100, product_id: productId }),
  });

  const [detailId, setDetailId] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const reext = useMutation({
    mutationFn: reextract,
    onSuccess: () => {
      message.success('已触发重抽取');
      qc.invalidateQueries({ queryKey: ['docs'] });
    },
  });

  const del = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['docs'] });
    },
  });

  return (
    <Card
      title="KB 文档"
      extra={
        <Button icon={<UploadOutlined />} type="primary" onClick={() => setUploadOpen(true)}>
          上传文档
        </Button>
      }
    >
      <Table
        rowKey="id"
        loading={docs.isLoading}
        dataSource={docs.data?.items || []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '文件名', dataIndex: 'file_name' },
          {
            title: '产品',
            dataIndex: 'product',
            width: 160,
            render: (p: any) =>
              p ? (
                <Tag color="blue">{p.name}</Tag>
              ) : (
                <Tag color="default">未绑定</Tag>
              ),
          },
          { title: '类型', dataIndex: 'mime', width: 70 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
          },
          { title: 'Chunk', dataIndex: 'chunk_count', width: 80 },
          { title: '创建时间', dataIndex: 'created_at', width: 170 },
          {
            title: '操作',
            width: 240,
            render: (_: any, r: any) => (
              <Space>
                <a onClick={() => setDetailId(r.id)}>详情</a>
                <a onClick={() => reext.mutate(r.id)}>重抽 KP</a>
                <Popconfirm title="确认删除？" onConfirm={() => del.mutate(r.id)}>
                  <a style={{ color: 'red' }}>删除</a>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <UploadModal
        open={uploadOpen}
        defaultProductId={productId}
        products={products}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          setUploadOpen(false);
          qc.invalidateQueries({ queryKey: ['docs'] });
        }}
      />
      <DocDetailModal id={detailId} products={products} onClose={() => setDetailId(null)} />
    </Card>
  );
}

function UploadModal({
  open,
  defaultProductId,
  products,
  onClose,
  onSuccess,
}: {
  open: boolean;
  defaultProductId: number | null;
  products: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedProduct, setSelectedProduct] = useState<number | null>(defaultProductId);
  const [file, setFile] = useState<File | null>(null);

  // 弹窗每次打开时，把当前 Header 选中的产品同步进来；
  // 否则在 Header 切了产品再开弹窗，依然是首次 mount 时的旧值
  useEffect(() => {
    if (open) {
      setSelectedProduct(defaultProductId);
      setFile(null);
    }
  }, [open, defaultProductId]);

  const upload = useMutation({
    mutationFn: () => uploadDocument(file!, selectedProduct!),
    onSuccess: () => {
      message.success('上传成功，后台处理中');
      setFile(null);
      onSuccess();
    },
    onError: (e: any) => message.error('上传失败: ' + (e?.response?.data?.detail || e.message)),
  });

  return (
    <Modal
      title="上传 KB 文档"
      open={open}
      onCancel={() => {
        setFile(null);
        onClose();
      }}
      onOk={() => upload.mutate()}
      okButtonProps={{ disabled: !file || !selectedProduct, loading: upload.isPending }}
      okText="上传"
      destroyOnClose
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>归属产品 *</div>
        <Select
          style={{ width: '100%' }}
          placeholder="选择产品"
          value={selectedProduct ?? undefined}
          onChange={(v) => setSelectedProduct(v)}
          options={products.map((p) => ({ label: `${p.name} (${p.code})`, value: p.id }))}
        />
      </div>
      <div>
        <div style={{ marginBottom: 4 }}>文件 *</div>
        <Upload
          beforeUpload={(f) => {
            setFile(f as File);
            return false;
          }}
          fileList={file ? [{ uid: '1', name: file.name, status: 'done' } as any] : []}
          onRemove={() => setFile(null)}
          accept=".pdf,.pptx,.md,.txt"
          maxCount={1}
        >
          <Button icon={<UploadOutlined />}>选择文件</Button>
        </Upload>
      </div>
    </Modal>
  );
}

function DocDetailModal({
  id,
  products,
  onClose,
}: {
  id: number | null;
  products: any[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const doc = useQuery({
    queryKey: ['doc', id],
    queryFn: () => getDocument(id!),
    enabled: !!id,
  });
  const chunks = useQuery({
    queryKey: ['doc-chunks', id],
    queryFn: () => listDocChunks(id!, { limit: 100 }),
    enabled: !!id,
  });

  const [backfillTarget, setBackfillTarget] = useState<number | null>(null);
  const backfill = useMutation({
    mutationFn: () => backfillDocProduct(id!, backfillTarget!),
    onSuccess: (r) => {
      message.success(`已回填：KP 共 ${r.total_kps}，新增 link ${r.added_links}`);
      qc.invalidateQueries({ queryKey: ['doc'] });
      qc.invalidateQueries({ queryKey: ['docs'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || e.message),
  });

  return (
    <Modal
      open={!!id}
      onCancel={onClose}
      footer={null}
      width={900}
      title={doc.data?.file_name || '文档详情'}
    >
      {doc.data && (
        <div style={{ marginBottom: 12 }}>
          <Space wrap>
            <Tag color={statusColor[doc.data.status]}>{doc.data.status}</Tag>
            <span>Chunk 数：{doc.data.chunk_count}</span>
            <span>
              产品：
              {doc.data.product ? (
                <Tag color="blue">{doc.data.product.name}</Tag>
              ) : (
                <Tag>未绑定</Tag>
              )}
            </span>
          </Space>
          {doc.data.error && <div style={{ color: 'red', marginTop: 8 }}>错误：{doc.data.error}</div>}
          {doc.data.latest_job && (
            <div style={{ marginTop: 8 }}>
              最近抽取：状态 {doc.data.latest_job.status} · 候选 {doc.data.latest_job.candidate_count} · 新 KP{' '}
              {doc.data.latest_job.new_kp_count}
            </div>
          )}
          <div style={{ marginTop: 12, padding: 8, background: '#fafafa', borderRadius: 4 }}>
            <Space>
              <span style={{ color: '#888' }}>把该文档下所有 KP 一键回填到：</span>
              <Select
                style={{ width: 220 }}
                placeholder="选目标产品"
                value={backfillTarget ?? undefined}
                onChange={(v) => setBackfillTarget(v)}
                options={products.map((p) => ({ label: `${p.name} (${p.code})`, value: p.id }))}
              />
              <Button
                type="primary"
                size="small"
                disabled={!backfillTarget}
                loading={backfill.isPending}
                onClick={() => backfill.mutate()}
              >
                回填
              </Button>
            </Space>
          </div>
        </div>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={chunks.isLoading}
        dataSource={chunks.data?.items || []}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '#', dataIndex: 'chunk_index', width: 50 },
          {
            title: 'Text',
            dataIndex: 'text',
            render: (t: string) => (
              <div style={{ maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{t}</div>
            ),
          },
          {
            title: 'KP',
            dataIndex: 'kp_ids',
            width: 140,
            render: (ids: number[]) => ids.map((i) => <Tag key={i}>{i}</Tag>),
          },
        ]}
      />
    </Modal>
  );
}
