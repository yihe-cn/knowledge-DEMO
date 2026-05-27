import { api } from './client';

export type CourseAssignment = {
  id: number;
  product_id: number;
  learner_id: number;
  status: 'active' | 'revoked';
  assigned_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  product?: { id: number; code: string; name: string; status: string } | null;
  learner?: { id: number; name: string; dept: string; external_ref: string } | null;
};

export async function listCourseAssignments(params: {
  product_id?: number;
  learner_id?: number;
  status?: 'active' | 'revoked';
} = {}) {
  const { data } = await api.get<{ items: CourseAssignment[] }>(
    '/admin/course-assignments',
    { params },
  );
  return data.items;
}

export async function assignCourse(body: { product_id: number; learner_ids: number[] }) {
  const { data } = await api.post<{ items: CourseAssignment[] }>(
    '/admin/course-assignments',
    body,
  );
  return data.items;
}

export async function revokeCourseAssignment(id: number) {
  const { data } = await api.delete<CourseAssignment>(`/admin/course-assignments/${id}`);
  return data;
}
