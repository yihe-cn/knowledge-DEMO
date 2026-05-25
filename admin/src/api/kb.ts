import { api } from './client';

export async function listDocuments(
  params: { status?: string; limit?: number; offset?: number; product_id?: number | null } = {},
) {
  const { product_id, ...rest } = params;
  const finalParams: any = { ...rest };
  if (product_id != null) finalParams.product_id = product_id;
  const { data } = await api.get<{ items: any[]; total: number }>('/admin/kb/documents', {
    params: finalParams,
  });
  return data;
}

export async function getDocument(id: number) {
  const { data } = await api.get(`/admin/kb/documents/${id}`);
  return data;
}

export async function uploadDocument(file: File, productId: number) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('product_id', String(productId));
  // 不要手动设 Content-Type —— FormData 必须让浏览器自动写带 boundary 的头，
  // 否则后端 FastAPI 解析 multipart 会直接 422
  const { data } = await api.post('/admin/kb/upload', fd);
  return data;
}

export async function reextract(id: number) {
  const { data } = await api.post(`/admin/kb/documents/${id}/reextract`);
  return data;
}

export async function deleteDocument(id: number) {
  const { data } = await api.delete(`/admin/kb/documents/${id}`);
  return data;
}

export async function listDocChunks(id: number, params: { limit?: number; offset?: number } = {}) {
  const { data } = await api.get<{ items: any[]; total: number }>(
    `/admin/kb/documents/${id}/chunks`,
    { params },
  );
  return data;
}
