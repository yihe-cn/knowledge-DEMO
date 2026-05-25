import { api } from './client';

export async function getOverview(params: { product_id?: number | null } = {}) {
  const finalParams: any = {};
  if (params.product_id != null) finalParams.product_id = params.product_id;
  const { data } = await api.get('/dashboard/overview', { params: finalParams });
  return data;
}

export async function getKpMap() {
  const { data } = await api.get<{ items: any[] }>('/dashboard/kp-map');
  return data.items;
}

export async function getAttention(params: { product_id?: number | null } = {}) {
  const finalParams: any = {};
  if (params.product_id != null) finalParams.product_id = params.product_id;
  const { data } = await api.get<{ items: any[]; total: number }>('/dashboard/attention', {
    params: finalParams,
  });
  return data;
}

export async function getKpDetail(id: number) {
  const { data } = await api.get(`/dashboard/kp/${id}/detail`);
  return data;
}
