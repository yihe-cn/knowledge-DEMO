import { api } from './client';

export type PracticeRole = {
  id: number;
  product_id: number;
  is_default: boolean;
  name: string;
  age: number;
  job: string;
  city: string;
  family: string;
  budget: string;
  tagline: string;
  vibe: string;
  emoji: string;
  avatar: string;
  avatarColor: string;
  motivation: string;
  opener: string;
  context: string;
  promptSeed: string;
  personality: string[];
  concerns: string[];
  mood: { interest?: number; trust?: number };
  source: 'ai' | 'manual';
};

export async function listRoles(productId: number) {
  const { data } = await api.get<{ items: PracticeRole[] }>(
    `/products/${productId}/roles`,
  );
  return data.items;
}

export async function generateRoles(productId: number) {
  const { data } = await api.post<{ items: PracticeRole[] }>(
    `/products/${productId}/roles/generate`,
  );
  return data.items;
}

export async function patchRole(roleId: number, body: Partial<PracticeRole>) {
  const { data } = await api.patch<PracticeRole>(`/practice-roles/${roleId}`, body);
  return data;
}

export async function deleteRole(roleId: number) {
  const { data } = await api.delete(`/practice-roles/${roleId}`);
  return data;
}

export async function setDefaultRole(roleId: number) {
  const { data } = await api.post<PracticeRole>(
    `/practice-roles/${roleId}/set-default`,
  );
  return data;
}
