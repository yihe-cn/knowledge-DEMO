import { api } from './client';

// 写入类操作的兜底 timeout — 若 dev proxy 或网络中断让响应丢失,
// promise 会在此 reject 而非永远 pending,避免 mutation.isPending 卡死、modal 锁定。
// 后端最长环节是 Milvus 回写(3 重试,每次几秒),30s 足够。
const WRITE_TIMEOUT = 30_000;
// 考题生成走 LLM，后端 ASSESSMENT_LLM_TIMEOUT_SEC=35s，
// 前端必须比它宽，否则前端先 timeout 但后端还在写库 → 状态错乱
const EXAM_GEN_TIMEOUT = 60_000;

export type Kp = {
  id: number;
  name: string;
  definition: string;
  category: string;
  status: string;
  version: number;
  chunk_count?: number;
  exam_status?: 'pending' | 'generating' | 'ready' | 'error';
  curriculum_status?: 'active' | 'removed' | 'not_in_course';
};

export async function listKps(
  params: { status?: string; limit?: number; offset?: number; product_id?: number | null } = {},
) {
  const { product_id, ...rest } = params;
  const finalParams: any = { ...rest };
  if (product_id != null) finalParams.product_id = product_id;
  const { data } = await api.get<{ items: Kp[] }>('/kp', { params: finalParams });
  return data.items;
}

export type KpCard = {
  tier: 'core' | 'detail';
  spec: string;
  customerVoice: string;
  sources: { type: string; label: string }[];
  appliesTo: string[];
  notApplicable: string[];
  rebuttals: { q: string; approach: string }[];
  sales: string;
  triggerQuestions: string[];
  aliases: string[];
  scenario: string;
  retrievalIndexedAt: string | null;
  retrievalIndexStatus: 'pending' | 'done' | 'failed';
  retrievalIndexError: string;
  enrichStatus: 'pending' | 'done' | 'failed';
  enrichError: string;
  enrichedAt: string | null;
  examQuestion: string;
  examRubric: string[];
  examStatus: 'pending' | 'generating' | 'ready' | 'error';
  examGeneratedAt: string | null;
  examError: string;
};

export type KpExam = {
  exam_question: string;
  exam_rubric: string[];
  exam_status: 'pending' | 'generating' | 'ready' | 'error';
  exam_generated_at: string | null;
  exam_error: string;
};

export type KpDetail = Kp & {
  chunk_links?: any[];
  products?: any[];
  card?: KpCard;
};

export async function getKp(id: number): Promise<KpDetail> {
  const { data } = await api.get<KpDetail>(`/kp/${id}`);
  return data;
}

export async function enrichKp(id: number) {
  const { data } = await api.post(`/kp/${id}/enrich`);
  // 后端 enrich_kp_sync 成功后内部会调 reindex_kp_sync；reindex 失败时会把 error 带回 reindex_warning。
  // 必须把它暴露给 UI，否则会出现"绿色成功提示 + Milvus 召回不起作用"的静默失效。
  return data as {
    ok: boolean;
    kp_id?: number;
    error?: string;
    reindex_warning?: string;
  };
}

export async function patchKpCard(
  id: number,
  body: Partial<{
    tier: 'core' | 'detail';
    spec: string;
    customer_voice: string;
    sources: { type: string; label: string }[];
    applies_to: string[];
    not_applicable: string[];
    rebuttals: { q: string; approach: string }[];
    sales: string;
    trigger_questions: string[];
    aliases: string[];
    scenario: string;
  }>,
) {
  // patch_kp_card 响应在 KpCard 基础上可能多带 reindexWarning（camelCase；reindex 失败时填）
  const { data } = await api.patch<KpCard & { reindexWarning?: string }>(
    `/kp/${id}/card`,
    body,
  );
  return data;
}

export async function reindexKpsBatch(body: {
  kp_ids?: number[] | null;
  reenrich?: boolean;
} = {}) {
  const { data } = await api.post<{
    ok: boolean;
    task_id: string | null;
    dispatch_error?: string;
    kp_ids: number[] | null;
    reenrich: boolean;
  }>('/kp/reindex-batch', body, { timeout: WRITE_TIMEOUT });
  return data;
}

export type KpReindexTaskStatus = {
  ok: boolean;
  task_id: string;
  state: string;
  done: boolean;
  current: number;
  total: number;
  percent: number;
  stage: string;
  kp_id?: number | null;
  ok_count: number;
  fail_count: number;
  result?: {
    ok: boolean;
    ok_count: number;
    fail_count: number;
    failures: any[];
    total: number;
    total_steps: number;
  } | null;
  error?: string;
};

export async function getReindexTaskStatus(taskId: string) {
  const { data } = await api.get<KpReindexTaskStatus>(`/kp/reindex-batch/${taskId}`);
  return data;
}

export async function patchKp(id: number, body: Partial<Kp>) {
  const { data } = await api.patch(`/kp/${id}`, body);
  // 响应里可能带 reindex_warning（status/name/definition 变更触发了重建索引）
  return data as Kp & { reindex_warning?: string };
}

export async function approveKp(id: number) {
  const { data } = await api.post(`/kp/${id}/approve`);
  return data as {
    ok: boolean;
    rewritten_chunks: number;
    reindex_warning?: string;
  };
}

export async function bulkApprove(kpIds: number[]): Promise<BulkApproveResult> {
  const { data } = await api.post('/kp/bulk-approve', { kp_ids: kpIds }, { timeout: WRITE_TIMEOUT });
  return data as BulkApproveResult;
}

export async function mergeKp(targetId: number, sourceId: number) {
  const { data } = await api.post(`/kp/${targetId}/merge`, { source_kp_id: sourceId });
  return data;
}

export async function listKpChunks(id: number, params: { limit?: number; offset?: number } = {}) {
  const { data } = await api.get<{ items: any[] }>(`/kp/${id}/chunks`, { params });
  return data.items;
}

export async function linkChunk(kpId: number, chunkId: number, relevance = 1.0) {
  const { data } = await api.post(`/kp/${kpId}/link`, { chunk_id: chunkId, relevance });
  return data;
}

export async function unlinkChunk(kpId: number, chunkId: number) {
  const { data } = await api.delete(`/kp/${kpId}/link/${chunkId}`);
  return data;
}

export async function enrichPendingKps(params: {
  product_id?: number | null;
  only_failed?: boolean;
} = {}) {
  const finalParams: any = {};
  if (params.product_id != null) finalParams.product_id = params.product_id;
  if (params.only_failed) finalParams.only_failed = true;
  const { data } = await api.post<{ ok: boolean; triggered: number; kp_ids: number[] }>(
    '/kp/enrich-pending',
    null,
    { params: finalParams },
  );
  return data;
}

export async function createKp(body: { name: string; definition: string; category?: string }) {
  const { data } = await api.post<Kp>('/kp', body);
  return data;
}

export async function deleteKp(id: number) {
  const { data } = await api.delete(`/kp/${id}`, { timeout: WRITE_TIMEOUT });
  return data as {
    ok: boolean;
    kp_id: number;
    milvus_rewritten_chunks: number;
    chunk_count: number;
    milvus_error: string;
  };
}

export type BulkDeleteResult = {
  ok: boolean;
  deleted_count: number;
  skipped_already_missing: number[];
  milvus_rewritten_chunks: number;
  chunk_count: number;
  milvus_error: string;
};

export async function bulkDeleteKps(kpIds: number[]) {
  const { data } = await api.post('/kp/bulk-delete', { kp_ids: kpIds }, { timeout: WRITE_TIMEOUT });
  return data as BulkDeleteResult;
}

export type BulkArchiveResult = {
  ok: boolean;
  archived: number;
  skipped_already_archived: number[];
  missing_ids: number[];
  milvus_rewritten_chunks: number;
  milvus_error: string;
};

export async function bulkArchiveKps(kpIds: number[]) {
  const { data } = await api.post('/kp/bulk-archive', { kp_ids: kpIds }, { timeout: WRITE_TIMEOUT });
  return data as BulkArchiveResult;
}

export type BulkApproveResult = {
  ok: boolean;
  approved: number;
  skipped_already_approved: number[];
  skipped_archived: number[];
  missing_ids: number[];
  rewritten_chunks: number;
  milvus_error: string;
};

export async function listExtractionJobs(params: { doc_id?: number; status?: string } = {}) {
  const { data } = await api.get<{ items: any[] }>('/kp-extraction-jobs', { params });
  return data.items;
}

// ── 学习闭环：单 KP 考题 ─────────────────────────────
export async function getKpExam(id: number) {
  const { data } = await api.get<KpExam>(`/kp/${id}/exam`);
  return data;
}

export async function putKpExam(
  id: number,
  body: { exam_question?: string; exam_rubric?: string[] },
) {
  const { data } = await api.put<KpExam>(`/kp/${id}/exam`, body);
  return data;
}

export async function generateKpExam(id: number) {
  const { data } = await api.post<KpExam>(`/kp/${id}/exam/generate`, null, {
    timeout: EXAM_GEN_TIMEOUT,
  });
  return data;
}

export async function generateKpExamBatch(kpIds: number[]) {
  const { data } = await api.post<{
    ok: boolean;
    triggered: number;
    succeeded: number[];
    failed: { kp_id: number; error: string }[];
  }>('/kp/exam/generate-batch', { kp_ids: kpIds }, { timeout: EXAM_GEN_TIMEOUT * 5 });
  return data;
}
