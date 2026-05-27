import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, message, Modal, Popconfirm, Progress, Segmented, Space, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  enrichPendingKps,
  generateKpExamBatch,
  getReindexTaskStatus,
  listKps,
  reindexKpsBatch,
  type Kp,
  type KpReindexTaskStatus,
} from '../api/kp';
import { useActiveProduct } from '../context/ActiveProduct';
import {
  useCreateItem, useArchiveItem, useDeleteItem,
  useBulkDeleteItems, useBulkArchiveItems, useBulkApproveItems,
} from '../hr/api';

const statusColor: Record<string, string> = {
  draft: 'gold',
  approved: 'green',
  archived: 'default',
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

const relationLabel: Record<string, string> = {
  active: '当前课程内',
  removed: '已从课程移除',
  not_in_course: '尚未加入课程',
};

const reindexStageLabel: Record<string, string> = {
  queued: '排队中',
  pending: '等待 worker',
  started: '已开始',
  enriching: '正在重新富化',
  enriched: '富化完成',
  enrich_failed: '富化失败',
  reindexing: '正在重建索引',
  indexed: '索引已写入',
  index_failed: '索引失败',
  exception: '执行异常',
  completed: '已完成',
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

// 把后端返回的 axios/HTTP 错误转换成对 HR 用户友好的提示
function describeError(err: any): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (err?.message) return err.message;
  return '操作失败,请稍后重试';
}

// 「搜索索引同步」是给 HR 用户的说法,后端字段是 milvus_*
function syncTail(rewritten: number): string {
  return rewritten > 0 ? `,搜索索引同步 ${rewritten} 个片段` : '';
}

export default function KpRegistry() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const [courseRelation, setCourseRelation] = useState<string>('all');
  const [enriching, setEnriching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { productId, products } = useActiveProduct();
  const nav = useNavigate();
  const [form] = Form.useForm();

  const kps = useQuery({
    queryKey: ['kps', status || 'all', productId],
    queryFn: () => listKps({ status: status || undefined, limit: 200, product_id: productId }),
  });

  const createMut = useCreateItem();
  const archiveMut = useArchiveItem();
  const deleteMut = useDeleteItem();
  const bulkDeleteMut = useBulkDeleteItems();
  const bulkArchiveMut = useBulkArchiveItems();
  const bulkApproveMut = useBulkApproveItems();
  const examMut = useMutation({ mutationFn: (ids: number[]) => generateKpExamBatch(ids) });

  const [approvedDel, setApprovedDel] = useState<{ id: number; name: string } | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [examRows, setExamRows] = useState<Kp[]>([]);
  const [lastExamFailedIds, setLastExamFailedIds] = useState<number[]>([]);
  const [reindexTask, setReindexTask] = useState<{
    taskId: string;
    reenrich: boolean;
    status?: KpReindexTaskStatus;
  } | null>(null);

  // 多选状态
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [selectedRows, setSelectedRows] = useState<Kp[]>([]);
  const selectedCount = selectedKeys.length;
  const selectedBreakdown = useMemo(() => {
    const out = { draft: 0, approved: 0, archived: 0 };
    selectedRows.forEach((r) => {
      const s = r.status as 'draft' | 'approved' | 'archived';
      if (s in out) out[s] += 1;
    });
    return out;
  }, [selectedRows]);
  const currentProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );
  const relationCounts = useMemo(() => {
    const rows = kps.data || [];
    return {
      all: rows.length,
      active: rows.filter((r) => r.curriculum_status === 'active').length,
      removed: rows.filter((r) => r.curriculum_status === 'removed').length,
      not_in_course: rows.filter((r) => r.curriculum_status === 'not_in_course').length,
    };
  }, [kps.data]);
  const tableRows = useMemo(() => {
    const rows = kps.data || [];
    if (!productId || courseRelation === 'all') return rows;
    return rows.filter((r) => r.curriculum_status === courseRelation);
  }, [kps.data, productId, courseRelation]);
  const examPrecheck = useMemo(() => buildExamPrecheck(examRows), [examRows]);
  const lastFailedRows = useMemo(() => {
    const byId = new Map((kps.data || []).map((r) => [r.id, r]));
    return lastExamFailedIds.map((id) => byId.get(id)).filter(Boolean) as Kp[];
  }, [kps.data, lastExamFailedIds]);

  // 批量删除 Modal:打开时把当前选择快照过来,后续切 tab/换产品都不会打断这个弹窗,
  // 用户的输入和「已选 N 项」展示保持稳定
  const [bulkDelSnapshot, setBulkDelSnapshot] = useState<{
    ids: number[];
    breakdown: { draft: number; approved: number; archived: number };
  } | null>(null);
  const [bulkDelConfirm, setBulkDelConfirm] = useState('');

  function clearSelection() {
    setSelectedKeys([]);
    setSelectedRows([]);
  }

  // 切换状态过滤 / 产品时清空选择 — 避免选中累积导致「已选 N 项」展示、
  // 确认数字、实际操作对象三者对不上;但不动正在开着的批量删除 modal,
  // 因为它已经拿到自己的 snapshot
  useEffect(() => {
    clearSelection();
    setCourseRelation('all');
  }, [status, productId]);

  useEffect(() => {
    if (!reindexTask?.taskId) return;
    const taskId = reindexTask.taskId;
    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await getReindexTaskStatus(taskId);
        if (disposed) return;
        setReindexTask((prev) => (prev?.taskId === taskId ? { ...prev, status: next } : prev));
        if (next.done) {
          if (timer) window.clearInterval(timer);
          if (next.ok && next.fail_count === 0) {
            message.success('召回索引任务已完成');
          } else if (next.ok) {
            message.warning(`召回索引任务完成，失败 ${next.fail_count} 个，请查看 KP 详情页错误信息`);
          } else {
            message.error(next.error || '召回索引任务失败');
          }
          qc.invalidateQueries({ queryKey: ['kps'] });
        }
      } catch (err) {
        if (disposed) return;
        if (timer) window.clearInterval(timer);
        message.error(describeError(err));
      }
    };

    timer = window.setInterval(poll, 2000);
    poll();
    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
    };
  }, [reindexTask?.taskId, qc]);

  function openBulkDelete() {
    setBulkDelSnapshot({ ids: [...selectedKeys], breakdown: { ...selectedBreakdown } });
    setBulkDelConfirm('');
  }

  function closeBulkDelete() {
    setBulkDelSnapshot(null);
    setBulkDelConfirm('');
  }
  // 弹窗里用 snapshot 而非当前 selection,这样切 tab/换产品不会让进行中的弹窗
  // 「数字突变 / 按钮突然 disable」
  const bulkDelSnapCount = bulkDelSnapshot?.ids.length ?? 0;
  const bulkDelSnapBreakdown = bulkDelSnapshot?.breakdown ?? { draft: 0, approved: 0, archived: 0 };
  const bulkDelExpectedConfirm = String(bulkDelSnapCount);
  const bulkDelRequiresType = bulkDelSnapBreakdown.approved > 0;
  const bulkDelEnabled =
    bulkDelSnapCount > 0 && (!bulkDelRequiresType || bulkDelConfirm === bulkDelExpectedConfirm);

  async function runDelete(id: number) {
    // 行内 Popconfirm 触发的删除不带 modal,沿用同步 toast 即可
    const toastKey = `del-${id}-${Date.now()}`;
    message.loading({ content: '正在删除…', key: toastKey, duration: 0 });
    try {
      const res = await deleteMut.mutateAsync(id);
      if (res.milvus_error) {
        message.warning({
          content: `条目已删除,但搜索索引同步失败(${res.chunk_count} 个片段待重试):${res.milvus_error}`,
          key: toastKey, duration: 6,
        });
      } else {
        message.success({
          content: `已删除${syncTail(res.milvus_rewritten_chunks)}`,
          key: toastKey, duration: 3,
        });
      }
    } catch (err) {
      message.error({ content: describeError(err), key: toastKey, duration: 5 });
      throw err;
    }
  }

  async function runBulkDelete() {
    if (!bulkDelSnapshot) return;
    const ids = bulkDelSnapshot.ids;
    const count = ids.length;

    // 乐观 UX:立刻关闭弹窗、清空选择,不阻塞用户。
    // 用可更新的 toast(同一个 key)反馈进度,即使响应延迟也不会让界面卡住。
    // 万一请求 timeout(client 端 30s),catch 也能正常更新 toast 为失败状态。
    closeBulkDelete();
    clearSelection();

    const toastKey = `bulk-del-${Date.now()}`;
    message.loading({ content: `正在删除 ${count} 个条目…`, key: toastKey, duration: 0 });

    try {
      const res = await bulkDeleteMut.mutateAsync(ids);
      const missing = res.skipped_already_missing.length;
      if (res.milvus_error) {
        message.warning({
          content: `已删除 ${res.deleted_count} 个条目,但搜索索引同步失败(${res.chunk_count} 个片段待重试):${res.milvus_error}`,
          key: toastKey,
          duration: 6,
        });
      } else if (missing > 0) {
        message.warning({
          content: `已删除 ${res.deleted_count} 个${syncTail(res.milvus_rewritten_chunks)};${missing} 个不存在已跳过`,
          key: toastKey,
          duration: 4,
        });
      } else {
        message.success({
          content: `已删除 ${res.deleted_count} 个条目${syncTail(res.milvus_rewritten_chunks)}`,
          key: toastKey,
          duration: 3,
        });
      }
    } catch (err) {
      message.error({ content: describeError(err), key: toastKey, duration: 5 });
    }
  }

  async function runBulkArchive() {
    try {
      const ids = selectedKeys;
      const res = await bulkArchiveMut.mutateAsync(ids);
      const skipped = res.skipped_already_archived.length;
      const missing = res.missing_ids.length;
      const extras: string[] = [];
      if (skipped > 0) extras.push(`${skipped} 个已是归档`);
      if (missing > 0) extras.push(`${missing} 个不存在`);
      const tail = extras.length ? `(${extras.join('、')}已跳过)` : '';
      if (res.milvus_error) {
        message.warning(
          `已归档 ${res.archived} 个${tail},但搜索索引同步失败:${res.milvus_error}`,
          6,
        );
      } else {
        message.success(`已归档 ${res.archived} 个条目${tail}${syncTail(res.milvus_rewritten_chunks)}`);
      }
      clearSelection();
    } catch (err) {
      message.error(describeError(err));
    }
  }

  async function runBulkApprove() {
    try {
      const ids = selectedKeys;
      const res = await bulkApproveMut.mutateAsync(ids);
      const sa = res.skipped_already_approved.length;
      const sx = res.skipped_archived.length;
      const missing = res.missing_ids.length;
      const extras: string[] = [];
      if (sa > 0) extras.push(`${sa} 个已发布`);
      if (sx > 0) extras.push(`${sx} 个已归档`);
      if (missing > 0) extras.push(`${missing} 个不存在`);
      const tail = extras.length ? `(${extras.join('、')}已跳过)` : '';
      if (res.milvus_error) {
        message.warning(
          `已发布 ${res.approved} 个${tail},但搜索索引同步失败:${res.milvus_error}`,
          6,
        );
      } else if (res.approved === 0 && (sa + sx + missing) > 0) {
        message.info(`无新发布条目${tail}`);
      } else {
        message.success(`已发布 ${res.approved} 个条目${tail}${syncTail(res.rewritten_chunks)}`);
      }
      clearSelection();
    } catch (err) {
      message.error(describeError(err));
    }
  }

  async function handleEnrichPending() {
    setEnriching(true);
    try {
      const res = await enrichPendingKps({ product_id: productId });
      if (res.triggered === 0) {
        message.info('没有待 enrich 的 KP');
      } else {
        message.success(`已触发 ${res.triggered} 个 KP 的 enrich,后台处理中…`);
      }
    } catch {
      message.error('触发失败,请检查服务状态');
    } finally {
      setEnriching(false);
    }
  }

  async function handleReindexAll(reenrich: boolean) {
    Modal.confirm({
      title: reenrich ? '重新富化 + 重建召回索引' : '重建召回索引',
      content: reenrich
        ? '将对所有 approved KP 重新调用 LLM 生成 trigger_questions/aliases/scenario 后再写入 Milvus。耗时较长且消耗 token。'
        : '将对所有 approved KP 重新拼接索引文本 + 重 embed 到 Milvus。不重新调用 LLM。',
      okText: '开始',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await reindexKpsBatch({ reenrich });
          if (!res.ok || !res.task_id) {
            message.error(res.dispatch_error || '派发 Celery 任务失败');
            return;
          }
          setReindexTask({ taskId: res.task_id, reenrich });
          message.success(`已派发 Celery 任务 ${res.task_id}`);
        } catch (err) {
          message.error(describeError(err));
        }
      },
    });
  }

  function openExamBatch(rows: Kp[]) {
    setExamRows(rows);
  }

  async function runExamBatch() {
    const ids = examPrecheck.generateRows.map((r) => r.id);
    if (ids.length === 0) return;
    const toastKey = `exam-batch-${Date.now()}`;
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
      clearSelection();
      qc.invalidateQueries({ queryKey: ['kps'] });
    } catch (err) {
      message.error({ content: describeError(err), key: toastKey, duration: 5 });
    }
  }

  async function handleCreate() {
    try {
      const values = await form.validateFields();
      const kp = await createMut.mutateAsync(values);
      message.success('知识条目已创建');
      form.resetFields();
      setCreateOpen(false);
      nav(`/hr/items/${kp.id}`);
    } catch (err: any) {
      // antd Form.validateFields 抛出的对象有 errorFields,不是后端错误
      if (err?.errorFields) return;
      message.error(describeError(err));
    }
  }

  // 「批量发布」按钮规则:有 archived 时禁用(归档条目要先编辑改回 draft 才能发布),
  // 否则有任意一条都可点(后端会自动跳过已 approved 的);count 为 0 时禁用
  const bulkApproveDisabled = selectedCount === 0 || selectedBreakdown.archived > 0;
  const bulkApproveTitle = selectedBreakdown.archived > 0
    ? '选中包含已归档条目,需先在详情页改回 draft 才能发布'
    : '';
  // 「批量归档」:全部已归档时禁用
  const bulkArchiveDisabled = selectedCount === 0 || selectedBreakdown.archived === selectedCount;
  const reindexStatus = reindexTask?.status;
  const reindexRunning = !!reindexTask && !reindexStatus?.done;
  const reindexFailCount = reindexStatus?.result?.fail_count ?? reindexStatus?.fail_count ?? 0;
  const reindexOkCount = reindexStatus?.result?.ok_count ?? reindexStatus?.ok_count ?? 0;
  const reindexTotalKps = reindexStatus?.result?.total ?? undefined;
  const reindexAlertType = !reindexStatus || reindexRunning
    ? 'info'
    : !reindexStatus.ok
      ? 'error'
      : reindexFailCount > 0
        ? 'warning'
        : 'success';

  return (
    <>
      <Card
        title={productId ? '知识条目 · 产品关联 KP' : '知识条目 · 全量 KP'}
        extra={
          <Space>
            {lastFailedRows.length > 0 && (
              <Button size="small" onClick={() => openExamBatch(lastFailedRows)}>
                重试失败考题 {lastFailedRows.length}
              </Button>
            )}
            <Button size="small" loading={enriching} onClick={handleEnrichPending}>
              Enrich 未完成
            </Button>
            <Button size="small" loading={reindexRunning} onClick={() => handleReindexAll(false)}>
              重建召回索引
            </Button>
            <Button size="small" loading={reindexRunning} onClick={() => handleReindexAll(true)}>
              重新富化+重建索引
            </Button>
            <Segmented
              value={status || 'all'}
              onChange={(v) => setStatus(v === 'all' ? '' : (v as string))}
              options={[
                { label: '全部', value: 'all' },
                { label: 'draft', value: 'draft' },
                { label: 'approved', value: 'approved' },
                { label: 'archived', value: 'archived' },
              ]}
            />
            <Button type="primary" onClick={() => setCreateOpen(true)}>+ 新建条目</Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            productId
              ? `${currentProduct?.name || '当前产品'}：这里展示产品关联 KP；课程关系筛选只说明这些 KP 是否在本课程学习路径中。`
              : '这里展示全部知识条目；发布、归档、删除是 KP 全局状态操作，会影响课程学习、AI 问答检索和考核引用。'
          }
        />
        {reindexTask && (
          <Alert
            type={reindexAlertType}
            showIcon
            closable={!reindexRunning}
            afterClose={() => setReindexTask(null)}
            style={{ marginBottom: 12 }}
            message={reindexTask.reenrich ? '重新富化 + 重建召回索引进度' : '重建召回索引进度'}
            description={
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                <Progress
                  percent={reindexStatus?.percent ?? 0}
                  status={!reindexStatus?.ok && reindexStatus?.done ? 'exception' : reindexRunning ? 'active' : 'success'}
                />
                <span style={{ color: '#666' }}>
                  {reindexStageLabel[reindexStatus?.stage || 'pending'] || reindexStatus?.stage || '处理中'}
                  {reindexStatus?.kp_id ? ` · KP ${reindexStatus.kp_id}` : ''}
                  {reindexStatus?.total ? ` · 步骤 ${reindexStatus.current}/${reindexStatus.total}` : ' · 正在等待任务状态'}
                  {reindexTotalKps != null ? ` · 共 ${reindexTotalKps} 个知识条目` : ''}
                  {reindexOkCount || reindexFailCount ? ` · 成功 ${reindexOkCount} / 失败 ${reindexFailCount}` : ''}
                </span>
                {reindexStatus?.error && <span style={{ color: '#b42318' }}>{reindexStatus.error}</span>}
              </Space>
            }
          />
        )}
        {productId && (
          <Space style={{ marginBottom: 12 }} wrap>
            <span style={{ color: '#666' }}>课程关系</span>
            <Segmented
              value={courseRelation}
              onChange={(v) => setCourseRelation(v as string)}
              options={[
                { label: `全部产品 KP ${relationCounts.all}`, value: 'all' },
                { label: `当前课程内 ${relationCounts.active}`, value: 'active' },
                { label: `已从课程移除 ${relationCounts.removed}`, value: 'removed' },
                { label: `尚未加入课程 ${relationCounts.not_in_course}`, value: 'not_in_course' },
              ]}
            />
          </Space>
        )}
        {selectedCount > 0 && (
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
              已选 <b>{selectedCount}</b> 项
              <span style={{ color: '#666', marginLeft: 8 }}>
                (draft {selectedBreakdown.draft} · approved {selectedBreakdown.approved} · archived {selectedBreakdown.archived})
              </span>
            </span>
            <div style={{ flex: 1 }} />
            <Button
              size="small"
              loading={examMut.isPending}
              onClick={() => openExamBatch(selectedRows)}
            >
              批量生成学习闭环考题
            </Button>
            <Popconfirm
              title={`批量发布 ${selectedBreakdown.draft} 个 draft 条目?`}
              description={
                selectedBreakdown.approved > 0
                  ? `选中含 ${selectedBreakdown.approved} 个已发布,会自动跳过`
                  : '将同步更新搜索索引'
              }
              okText="发布"
              cancelText="取消"
              disabled={bulkApproveDisabled || selectedBreakdown.draft === 0}
              onConfirm={runBulkApprove}
            >
              <Button
                size="small"
                disabled={bulkApproveDisabled || selectedBreakdown.draft === 0}
                title={bulkApproveTitle || (selectedBreakdown.draft === 0 ? '选中无 draft 条目,无可发布项' : '')}
              >
                批量发布
              </Button>
            </Popconfirm>
            <Popconfirm
              title={`批量归档 ${selectedCount} 个条目?`}
              description={selectedBreakdown.approved > 0
                ? `其中 ${selectedBreakdown.approved} 个已发布；归档是全局操作，学员端课程、AI 问答检索和考核引用都会受影响。`
                : '归档是全局 KP 状态操作，不是从某个课程移除。'}
              okText="归档"
              cancelText="取消"
              disabled={bulkArchiveDisabled}
              onConfirm={runBulkArchive}
            >
              <Button size="small" disabled={bulkArchiveDisabled}>批量归档</Button>
            </Popconfirm>
            <Button
              size="small"
              danger
              onClick={openBulkDelete}
            >
              批量删除
            </Button>
            <Button size="small" type="text" onClick={clearSelection}>清空选择</Button>
          </div>
        )}

        <Table<Kp>
          rowKey="id"
          loading={kps.isLoading}
          dataSource={tableRows}
          locale={{
            emptyText: productId
              ? '当前筛选下没有产品关联 KP。请切换 KP 状态或课程关系筛选。'
              : '当前筛选下没有知识条目。',
          }}
          pagination={{ pageSize: 30 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys, rows) => {
              setSelectedKeys(keys as number[]);
              setSelectedRows(rows);
            },
            // 不开 preserveSelectedRowKeys:切换 status/product 时由 useEffect 清空,
            // 同页内分页保留的需求很弱,优先保证选择/统计/操作三者对应
          }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 70 },
            {
              title: '名称',
              dataIndex: 'name',
              render: (n: string, r: any) => <Link to={`/hr/items/${r.id}`}>{n}</Link>,
            },
            { title: '分类', dataIndex: 'category', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
            },
            {
              title: '定义',
              dataIndex: 'definition',
              render: (d: string) => <span style={{ color: '#666' }}>{(d || '').slice(0, 80)}</span>,
            },
            { title: '版本', dataIndex: 'version', width: 70 },
            {
              title: '考题',
              dataIndex: 'exam_status',
              width: 100,
              filters: [
                { text: '待生成', value: 'pending' },
                { text: '生成中', value: 'generating' },
                { text: '已就绪', value: 'ready' },
                { text: '失败', value: 'error' },
              ],
              onFilter: (v: any, r: any) => (r.exam_status || 'pending') === v,
              render: (s: string) => {
                const v = s || 'pending';
                return <Tag color={examStatusColor[v] || 'default'}>{examStatusLabel[v] || v}</Tag>;
              },
            },
            ...(productId ? [{
              title: '课程关系',
              dataIndex: 'curriculum_status',
              width: 130,
              render: (s: string) => <Tag>{relationLabel[s] || s || '-'}</Tag>,
            }] : []),
            {
              title: '操作',
              width: 170,
              render: (_: any, r: any) => (
                <Space size={4}>
                  <Popconfirm
                    title="确认归档此条目?"
                    okText="归档"
                    cancelText="取消"
                    disabled={r.status === 'archived'}
                    onConfirm={async () => {
                      try {
                        await archiveMut.mutateAsync(r.id);
                        message.success('已归档');
                      } catch (err) {
                        message.error(describeError(err));
                      }
                    }}
                  >
                    <Button size="small" disabled={r.status === 'archived'}>
                      归档
                    </Button>
                  </Popconfirm>
                  {r.status === 'approved' ? (
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        setApprovedDel({ id: r.id, name: r.name });
                        setConfirmName('');
                      }}
                    >
                      删除
                    </Button>
                  ) : (
                    <Popconfirm
                      title="确认彻底删除?"
                      description="删除是全局操作，会同步更新搜索索引，并影响课程学习与考核引用。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => runDelete(r.id).catch(() => {})}
                    >
                      <Button size="small" danger>删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="新建知识条目"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例:产品核心卖点" />
          </Form.Item>
          <Form.Item name="definition" label="定义">
            <Input.TextArea rows={4} placeholder="简要描述此知识条目的含义" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="例:产品知识" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="删除已发布的知识条目"
        open={approvedDel != null}
        onCancel={() => setApprovedDel(null)}
        okText="确认删除"
        okButtonProps={{
          danger: true,
          disabled: !approvedDel || confirmName !== approvedDel.name,
        }}
        onOk={() => {
          if (!approvedDel) return;
          // 乐观关闭:立刻关弹窗,删除在后台跑、用 toast 反馈结果
          const id = approvedDel.id;
          setApprovedDel(null);
          setConfirmName('');
          runDelete(id).catch(() => {/* runDelete 已经 toast 过了 */});
        }}
      >
        <p style={{ color: '#cf1322', marginTop: 0 }}>
          此条目当前处于 <b>approved</b> 状态,可能正在被课程学习、AI 问答检索和考核引用。
        </p>
        <p>删除将:</p>
        <ul style={{ paddingLeft: 20, color: '#666' }}>
          <li>从数据库永久移除该条目及所有关联(关联文档片段、产品、卡片)</li>
          <li>同步更新 AI 问答的搜索索引</li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          为防误删,请输入完整名称 <b>{approvedDel?.name}</b> 以确认:
        </p>
        <Input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder="输入 KP 名称"
          autoFocus
        />
      </Modal>

      <Modal
        title={`批量删除 ${bulkDelSnapCount} 个知识条目`}
        open={bulkDelSnapshot != null}
        onCancel={closeBulkDelete}
        okText="确认删除"
        okButtonProps={{ danger: true, disabled: !bulkDelEnabled }}
        confirmLoading={bulkDeleteMut.isPending}
        onOk={runBulkDelete}
      >
        <p style={{ marginTop: 0 }}>
          将删除 <b>{bulkDelSnapCount}</b> 个条目(draft <b>{bulkDelSnapBreakdown.draft}</b> · approved{' '}
          <b style={{ color: bulkDelSnapBreakdown.approved > 0 ? '#cf1322' : undefined }}>
            {bulkDelSnapBreakdown.approved}
          </b>{' '}
          · archived <b>{bulkDelSnapBreakdown.archived}</b>)。
        </p>
        {bulkDelSnapBreakdown.approved > 0 && (
          <p style={{ color: '#cf1322' }}>
            其中 {bulkDelSnapBreakdown.approved} 个处于 <b>approved</b> 状态,
            可能正在被课程学习、AI 问答检索和考核模板引用,删除后无法恢复。
          </p>
        )}
        <p>删除将:</p>
        <ul style={{ paddingLeft: 20, color: '#666' }}>
          <li>从数据库永久移除所有选中条目及其关联(文档片段、产品、卡片)</li>
          <li>同步更新 AI 问答的搜索索引</li>
        </ul>
        {bulkDelRequiresType && (
          <>
            <p style={{ marginBottom: 8 }}>
              为防误删,请输入选中数量 <b>{bulkDelExpectedConfirm}</b> 以确认:
            </p>
            <Input
              value={bulkDelConfirm}
              onChange={(e) => setBulkDelConfirm(e.target.value)}
              placeholder={`输入 ${bulkDelExpectedConfirm}`}
              autoFocus
            />
          </>
        )}
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
    </>
  );
}
