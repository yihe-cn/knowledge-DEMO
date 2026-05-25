import { useState } from 'react';
import { Modal, Select, Spin, Alert, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { listKps, mergeKp, type Kp } from '../api/kp';

export default function KpMergeModal({
  open,
  sourceKp,
  onClose,
  onMerged,
}: {
  open: boolean;
  sourceKp: Kp | null;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [targetId, setTargetId] = useState<number | null>(null);
  const approved = useQuery({
    queryKey: ['kps', 'approved'],
    queryFn: () => listKps({ status: 'approved', limit: 500 }),
    enabled: open,
  });
  const merge = useMutation({
    mutationFn: () => mergeKp(targetId!, sourceKp!.id),
    onSuccess: () => {
      message.success('合并完成');
      onMerged();
    },
    onError: (e: any) => message.error('合并失败: ' + (e?.response?.data?.detail || e.message)),
  });

  return (
    <Modal
      open={open}
      title={sourceKp ? `合并 KP「${sourceKp.name}」到` : '合并 KP'}
      onCancel={onClose}
      onOk={() => merge.mutate()}
      okButtonProps={{ disabled: !targetId, loading: merge.isPending }}
    >
      <Alert
        type="warning"
        showIcon
        message="合并后源 KP 会归档，所有 chunk 关联迁移到目标 KP。"
        style={{ marginBottom: 12 }}
      />
      {approved.isLoading ? (
        <Spin />
      ) : (
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择目标 KP（已通过）"
          value={targetId ?? undefined}
          onChange={(v) => setTargetId(v)}
          optionFilterProp="label"
          options={(approved.data || [])
            .filter((k) => k.id !== sourceKp?.id)
            .map((k) => ({ label: `${k.name} (${k.category || '未分类'})`, value: k.id }))}
        />
      )}
    </Modal>
  );
}
