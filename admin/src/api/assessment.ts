import { api } from './client';

export type AssessmentQuestion = {
  idx: number;
  text: string;
  rubric: string[];
  ref_chunk_ids: number[];
  ref_kp_ids: number[];
};

export type AssessmentTemplate = {
  id: number;
  title: string;
  mode: 'bank' | 'ai_oral';
  product_id: number | null;
  scope: { kp_ids: number[]; product_ids: number[] };
  question_set: AssessmentQuestion[];
  pass_score: number;
  time_limit_sec: number | null;
  num_questions: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type Learner = {
  id: number;
  name: string;
  dept: string;
  external_ref: string;
  created_at: string;
};

export type Assignment = {
  id: number;
  template_id: number;
  learner_id: number;
  learner_name: string;
  token: string;
  share_url: string;
  status: string;
  due_at: string | null;
  score: number | null;
  started_at: string | null;
  submitted_at: string | null;
  graded_at: string | null;
  created_at: string;
};

export type AssignmentResponse = {
  id: number;
  turn_idx: number;
  question_text: string;
  answer_text: string;
  ai_score: number | null;
  ai_feedback: any;
  human_score_override: number | null;
  human_comment: string;
  created_at: string;
};

export type AssignmentDetail = Assignment & {
  template: AssessmentTemplate | null;
  responses: AssignmentResponse[];
};

// ── Templates ────────────────────────────────────────
export async function listTemplates() {
  const { data } = await api.get<{ items: AssessmentTemplate[] }>('/admin/assessments/templates');
  return data.items;
}

export async function getTemplate(id: number) {
  const { data } = await api.get<AssessmentTemplate>(`/admin/assessments/templates/${id}`);
  return data;
}

export async function createTemplate(body: Partial<AssessmentTemplate>) {
  const { data } = await api.post<AssessmentTemplate>('/admin/assessments/templates', body);
  return data;
}

export async function patchTemplate(id: number, body: Partial<AssessmentTemplate>) {
  const { data } = await api.patch<AssessmentTemplate>(`/admin/assessments/templates/${id}`, body);
  return data;
}

export async function aiGenerateQuestions(
  id: number,
  body: { num: number; difficulty: 'easy' | 'normal' | 'hard' },
) {
  const { data } = await api.post<{ questions: Omit<AssessmentQuestion, 'idx'>[] }>(
    `/admin/assessments/templates/${id}/generate-questions`,
    body,
  );
  return data.questions;
}

// ── Learners ─────────────────────────────────────────
export async function listLearners() {
  const { data } = await api.get<{ items: Learner[] }>('/admin/learners');
  return data.items;
}

export async function createLearner(body: { name: string; dept?: string; external_ref?: string }) {
  const { data } = await api.post<Learner>('/admin/learners', body);
  return data;
}

// ── Assignments ──────────────────────────────────────
export async function assignTemplate(body: {
  template_id: number;
  learner_ids: number[];
  due_at?: string | null;
}) {
  const { data } = await api.post<{ items: Assignment[] }>('/admin/assessments/assign', body);
  return data.items;
}

export async function listAssignments(params: {
  template_id?: number;
  learner_id?: number;
  status?: string;
} = {}) {
  const { data } = await api.get<{ items: Assignment[] }>(
    '/admin/assessments/assignments',
    { params },
  );
  return data.items;
}

export async function getAssignment(id: number) {
  const { data } = await api.get<AssignmentDetail>(`/admin/assessments/assignments/${id}`);
  return data;
}

export async function overrideResponse(
  assignmentId: number,
  body: { response_id: number; human_score: number; comment?: string },
) {
  const { data } = await api.post(
    `/admin/assessments/assignments/${assignmentId}/override`,
    body,
  );
  return data;
}

export async function regenerateLink(assignmentId: number) {
  const { data } = await api.post<Assignment>(
    `/admin/assessments/assignments/${assignmentId}/regenerate-link`,
  );
  return data;
}

export async function stopAssignment(assignmentId: number) {
  const { data } = await api.post<Assignment>(
    `/admin/assessments/assignments/${assignmentId}/stop`,
  );
  return data;
}

export async function finishAssignment(assignmentId: number) {
  const { data } = await api.post<Assignment>(
    `/admin/assessments/assignments/${assignmentId}/finish`,
  );
  return data;
}

// ── Stats ─────────────────────────────────────────────
export async function getStats() {
  const { data } = await api.get<{
    by_template: any[];
    by_learner: any[];
    by_kp: any[];
  }>('/admin/assessments/stats');
  return data;
}
