import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listKps, getKp, listKpChunks, approveKp, type Kp } from '../api/kp';
import { getDocument, listDocuments, listDocChunks, reextract, uploadDocument } from '../api/kb';
import { getOverview, getAttention } from '../api/dashboard';
import { useActiveProduct } from '../context/ActiveProduct';

/* ------------ types ------------ */
export type HrItem = Kp & {
  updated_at?: string;
  created_by?: string;
};

export type HrItemDetail = HrItem & {
  chunk_links?: Array<{ chunk_id: number; relevance: number; source?: string }>;
  products?: Array<{ id: number; code: string; name: string }>;
};

export type HrDoc = {
  id: number;
  file_name: string;
  mime?: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  chunk_count: number;
  product?: { id: number; code: string; name: string };
  created_at?: string;
  updated_at?: string;
  error?: string | null;
};

export type Overview = {
  kp_total: number;
  kp_approved: number;
  kp_draft: number;
  kp_archived: number;
  approved_ratio: number;
  doc_total: number;
  doc_ready: number;
  doc_failed: number;
  doc_pending: number;
  pending_review: number;
};

export type AttentionItem = {
  type: string;
  target_id: number;
  title: string;
  detail: string;
};

/* ------------ helpers ------------ */
export function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  if (d < 30) return `${Math.floor(d / 7)} 周前`;
  if (d < 365) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}

export function formatItemId(id: number) {
  return `KP-${String(id).padStart(4, '0')}`;
}

export function formatVersion(v?: number) {
  return v == null ? 'v—' : `v${v}`;
}

/* ------------ queries ------------ */
export function useOverview() {
  const { productId } = useActiveProduct();
  return useQuery<Overview>({
    queryKey: ['hr', 'overview', productId],
    queryFn: () => getOverview({ product_id: productId }),
  });
}

export function useAttention() {
  const { productId } = useActiveProduct();
  return useQuery<{ items: AttentionItem[]; total: number }>({
    queryKey: ['hr', 'attention', productId],
    queryFn: () => getAttention({ product_id: productId }),
  });
}

export function useItems(params: { status?: string; limit?: number } = {}) {
  const { productId } = useActiveProduct();
  const status = params.status;
  return useQuery<HrItem[]>({
    queryKey: ['hr', 'items', status || 'all', productId],
    queryFn: () => listKps({ status, limit: params.limit ?? 200, product_id: productId }) as Promise<HrItem[]>,
  });
}

export function useItem(id: number | null | undefined) {
  return useQuery<HrItemDetail>({
    queryKey: ['hr', 'item', id],
    queryFn: () => getKp(id!) as Promise<HrItemDetail>,
    enabled: id != null,
  });
}

export function useItemChunks(id: number | null | undefined) {
  return useQuery<any[]>({
    queryKey: ['hr', 'item-chunks', id],
    queryFn: () => listKpChunks(id!),
    enabled: id != null,
  });
}

export function useDocs() {
  const { productId } = useActiveProduct();
  return useQuery<{ items: HrDoc[]; total: number }>({
    queryKey: ['hr', 'docs', productId],
    queryFn: () => listDocuments({ limit: 200, product_id: productId }) as Promise<{ items: HrDoc[]; total: number }>,
  });
}

export function useDocChunks(docId: number | null | undefined) {
  return useQuery<{ items: any[]; total: number }>({
    queryKey: ['hr', 'doc-chunks', docId],
    queryFn: () => listDocChunks(docId!, { limit: 20 }),
    enabled: docId != null,
  });
}

export function useDoc(docId: number | null | undefined) {
  return useQuery<HrDoc & { source_path?: string; latest_job?: any }>({
    queryKey: ['hr', 'doc', docId],
    queryFn: () => getDocument(docId!),
    enabled: docId != null,
  });
}

export function useUploadDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, productId }: { file: File; productId: number }) =>
      uploadDocument(file, productId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'docs'] });
      qc.invalidateQueries({ queryKey: ['hr', 'overview'] });
    },
  });
}

export function useReextractDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => reextract(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['hr', 'docs'] });
      qc.invalidateQueries({ queryKey: ['hr', 'doc', id] });
      qc.invalidateQueries({ queryKey: ['hr', 'overview'] });
      qc.invalidateQueries({ queryKey: ['hr', 'attention'] });
    },
  });
}

export function useApproveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => approveKp(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'items'] });
      qc.invalidateQueries({ queryKey: ['hr', 'overview'] });
      qc.invalidateQueries({ queryKey: ['hr', 'attention'] });
    },
  });
}
