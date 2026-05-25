import { api } from './client';

export type Kp = {
  id: number;
  name: string;
  definition: string;
  category: string;
  status: string;
  version: number;
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

export async function getKp(id: number) {
  const { data } = await api.get(`/kp/${id}`);
  return data;
}

export async function patchKp(id: number, body: Partial<Kp>) {
  const { data } = await api.patch(`/kp/${id}`, body);
  return data;
}

export async function approveKp(id: number) {
  const { data } = await api.post(`/kp/${id}/approve`);
  return data;
}

export async function bulkApprove(kpIds: number[]) {
  const { data } = await api.post('/kp/bulk-approve', { kp_ids: kpIds });
  return data;
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

export async function listExtractionJobs(params: { doc_id?: number; status?: string } = {}) {
  const { data } = await api.get<{ items: any[] }>('/kp-extraction-jobs', { params });
  return data.items;
}
