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
};

export async function listProducts() {
  const { data } = await api.get<{ items: Product[] }>('/products');
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

export async function unbindKpProduct(kpId: number, productId: number) {
  const { data } = await api.delete(`/kp/${kpId}/products/${productId}`);
  return data;
}
