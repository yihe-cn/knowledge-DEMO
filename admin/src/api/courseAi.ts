import { api } from './client';

export type BootstrapResp = {
  ok: boolean;
  new_kps: number;
  reused: number;
  new_links: number;
  total: number;
  conflicts: { name: string; reason: string }[];
};

export type ReorganizeResp = {
  ok: boolean;
  total: number;
  changed: { id: number; name: string; old: string; new: string }[];
};

export async function bootstrapKps(productId: number, moduleCount = 4) {
  const { data } = await api.post<BootstrapResp>(
    `/products/${productId}/kps/bootstrap`,
    null,
    { params: { module_count: moduleCount } },
  );
  return data;
}

export async function reorganizeKps(productId: number) {
  const { data } = await api.post<ReorganizeResp>(
    `/products/${productId}/kps/reorganize`,
  );
  return data;
}
