import { api } from './client';

export type Product = {
  id: number;
  code: string;
  name: string;
  industry: string;
  student_role: string;
  customer_label: string;
  description: string;
  features_brief: string;
  allow_experience_answer: boolean;
  status: string;
  kp_count: number;
  doc_count: number;
  pass_score: number;
  cover_image_url?: string | null;
};

export async function listProducts() {
  const { data } = await api.get<{ items: Product[] }>('/products');
  return data.items;
}

export async function listProductKps(
  productId: number,
  params: {
    status?: string;
    limit?: number;
    offset?: number;
    include_removed_curriculum?: boolean;
  } = {},
) {
  const { data } = await api.get<{ items: any[] }>(`/products/${productId}/kps`, { params });
  return data.items;
}

export async function createProduct(body: Partial<Product>) {
  const { data } = await api.post('/products', body);
  return data;
}

export async function patchProduct(id: number, body: Partial<Product>) {
  const { data } = await api.patch(`/products/${id}`, body);
  return data;
}

export async function deleteProduct(id: number) {
  const { data } = await api.delete<Product>(`/products/${id}`);
  return data;
}

export async function backfillDocProduct(docId: number, productId: number) {
  const { data } = await api.post(`/admin/kb/documents/${docId}/backfill-product`, {
    product_id: productId,
  });
  return data;
}

export async function bindKpProducts(kpId: number, productIds: number[]) {
  const { data } = await api.post(`/kp/${kpId}/products`, { product_ids: productIds });
  return data;
}

export async function addKpProduct(kpId: number, productId: number) {
  const { data } = await api.post(`/kp/${kpId}/products/${productId}`);
  return data;
}

export async function unbindKpProduct(kpId: number, productId: number) {
  const { data } = await api.delete(`/kp/${kpId}/products/${productId}`);
  return data;
}

export async function removeProductCurriculumKp(productId: number, kpId: number) {
  const { data } = await api.delete(`/products/${productId}/curriculum/${kpId}`);
  return data;
}

// ── 学习闭环：product 课程编排 ────────────────────────
export type ProductCurriculumItem = {
  kp_id: number;
  id: number;
  order_index: number;
  name: string;
  definition?: string;
  category: string;
  status: string;
  version?: number;
  chunk_count?: number;
  exam_status?: 'pending' | 'generating' | 'ready' | 'error';
  curriculum_status?: 'active' | 'removed' | 'not_in_course';
  card?: any;
};

export async function listProductCurriculum(productId: number) {
  const { data } = await api.get<{ items: ProductCurriculumItem[] }>(
    `/products/${productId}/curriculum`,
  );
  return data.items;
}

export async function setProductCurriculum(productId: number, kpIds: number[]) {
  const { data } = await api.put(`/products/${productId}/curriculum`, { kp_ids: kpIds });
  return data as { ok: boolean; kp_ids: number[] };
}

export async function uploadProductCover(productId: number, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<{ cover_image_url: string; url: string }>(
    `/products/${productId}/cover-image`,
    fd,
  );
  return data;
}
