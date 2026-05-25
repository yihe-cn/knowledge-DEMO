import { api } from './client';

export async function getOverview() {
  const { data } = await api.get('/dashboard/overview');
  return data;
}

export async function getKpMap() {
  const { data } = await api.get<{ items: any[] }>('/dashboard/kp-map');
  return data.items;
}

export async function getAttention() {
  const { data } = await api.get<{ items: any[]; total: number }>('/dashboard/attention');
  return data;
}

export async function getKpDetail(id: number) {
  const { data } = await api.get(`/dashboard/kp/${id}/detail`);
  return data;
}
