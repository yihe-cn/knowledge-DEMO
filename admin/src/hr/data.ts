/* HR 知识中台 · 状态文案 + Insights/Audit 暂未接入后端的 mock 数据 */

export const STATUS_LABEL: Record<string, string> = {
  draft: '待办',
  review: '待办',
  approved: '已发布',
  archived: '已归档',
  expiring: '即将失效',
  pending: '待处理',
  processing: '处理中',
  ready: '已就绪',
  failed: '失败',
};

/* ============================================================
   以下数据仅用于"问答洞察 / 变更审计"两个尚未接入后端的页面，
   按"宝怡乐 PAX®"产品（脉冲消融导管 + Opal 三维系统）的领域语境
   构造 mock：用户 = 医药代表 / 医生；维度 = 产品类目 × 销售大区。
   接口就绪后应整体替换为 useQuery 钩子。
   ============================================================ */

export interface Department { code: string; name: string; }
export interface Faq { q: string; hits: number; hit: boolean; item?: string; }
export interface Coverage { cat: string; vals: number[]; }
export interface AuditEvent {
  t: string;
  who: string;
  role: string;
  action: '发布' | '审核通过' | '驳回' | '回滚' | '解绑' | '上传' | '归档' | '修订';
  target: string;
  targetId?: string;
  note?: string;
}

/* 销售大区：作为知识覆盖矩阵的列维度 */
export const DEPARTMENTS: Department[] = [
  { code: 'HD',  name: '华东大区' },
  { code: 'HN',  name: '华南大区' },
  { code: 'HB',  name: '华北大区' },
  { code: 'XB',  name: '西北大区' },
  { code: 'XN',  name: '西南大区' },
  { code: 'DB',  name: '东北大区' },
  { code: 'KOL', name: 'KOL/学术' },
];

/* 医生 / 代表实际提出的高频问题 */
export const FAQS: Faq[] = [
  { q: 'CTI 脉冲消融如何避免房室结损伤？',         hits: 412, hit: true,  item: 'KP-0083' },
  { q: 'Field Tag 的损伤预测准确度依赖什么？',     hits: 287, hit: true,  item: 'KP-0081' },
  { q: '二代导管做 PVI+ 时和一代有何区别？',       hits: 156, hit: false },
  { q: '复杂 redo 病例标测导管该选哪一个？',       hits: 138, hit: true,  item: 'KP-0078' },
  { q: 'CT-MERGE 模块需要术前做几期 CT？',         hits: 124, hit: false },
  { q: '无压力提示时如何确认导管贴靠？',           hits: 98,  hit: true,  item: 'KP-0075' },
  { q: '宝怡乐 PAX® 的医保编码是什么？',           hits: 87,  hit: false },
  { q: '脉冲消融术中食道损伤概率有数据吗？',       hits: 76,  hit: true,  item: 'KP-0072' },
];

/* 覆盖矩阵：行 = 真实 KP 类目；列 = 销售大区。数值 = 该大区代表在该类目下命中率 % */
export const COVERAGE: Coverage[] = [
  { cat: '产品知识', vals: [95, 92, 90, 78, 80, 75, 98] },
  { cat: '原理科普', vals: [88, 85, 82, 70, 72, 68, 96] },
  { cat: '临床应用', vals: [90, 88, 84, 65, 70, 60, 95] },
  { cat: '临床技术', vals: [82, 80, 76, 55, 58, 52, 94] },
  { cat: '临床数据', vals: [85, 82, 78, 60, 62, 58, 98] },
  { cat: '医学诊断', vals: [70, 68, 65, 50, 52, 48, 90] },
  { cat: '临床研究', vals: [68, 65, 60, 45, 48, 42, 96] },
  { cat: '销售话术', vals: [92, 90, 88, 82, 85, 80, 70] },
];

/* 变更审计：围绕 KP 发布 / 文档上传 / 审核流程 */
export const AUDIT_EVENTS: AuditEvent[] = [
  { t: '2026-05-25 14:22', who: '王医学', role: '医学事务', action: '修订',     target: 'CTI消融的房室结防护机制',           targetId: 'KP-0083', note: '补充 His 束标注流程示意，提交待审' },
  { t: '2026-05-25 11:08', who: '李培训', role: '产品培训', action: '上传',     target: 'PAX 内训 2.5h 肠道微生态.pptx',     targetId: 'D-0001' },
  { t: '2026-05-24 17:45', who: '陈合规', role: '合规',     action: '上传',     target: 'FARAWAVE NAV 适应症声明.docx',      targetId: 'D-0006' },
  { t: '2026-05-24 10:30', who: '周经理', role: '产品经理', action: '审核通过', target: 'Field Tag 准确性的判定前提',         targetId: 'KP-0076' },
  { t: '2026-05-23 16:42', who: '系统',   role: '自动',     action: '发布',     target: '三维系统房室结损伤防范策略',         targetId: 'KP-0072', note: '已推送至代表移动端 / 医生学术助手' },
  { t: '2026-05-23 16:40', who: '张总监', role: '医学总监', action: '审核通过', target: '三维系统房室结损伤防范策略',         targetId: 'KP-0072', note: 'KOL 复核口径与最新 EHRA 指南一致' },
  { t: '2026-05-22 11:15', who: '张总监', role: '医学总监', action: '驳回',     target: 'FARAWAVE复杂病例标测策略 v0.6',     targetId: 'KP-0078', note: '需补充 Orion 与 PentaRay 对比数据' },
  { t: '2026-05-20 09:30', who: '周经理', role: '产品经理', action: '发布',     target: 'Opal系统CT-MERGE模块',              targetId: 'KP-0077' },
  { t: '2026-05-15 18:02', who: '陈合规', role: '合规',     action: '归档',     target: '2024 PAX 早期试用宣传话术',          targetId: 'KP-0042', note: '与 NMPA 最新表述不符，已被 KP-0079 取代' },
  { t: '2026-05-10 09:00', who: '王医学', role: '医学事务', action: '解绑',     target: '内训 v2 → 消融导管贴靠多维度判断',  targetId: 'KP-0075', note: '替换为 PAX 内训 2.5h 切片 #08' },
  { t: '2026-05-08 14:20', who: '林学术', role: 'KOL 联络', action: '修订',     target: '二峡与三峡脉冲消融效果',             targetId: 'KP-0082', note: '加入 2025 ESC 二代导管 PVI+ 长期随访数据' },
  { t: '2026-05-03 10:08', who: '周经理', role: '产品经理', action: '回滚',     target: '二维与三维价格体系',                 targetId: 'KP-0079', note: '回滚至上版，新版试用窗口尚未与商务对齐' },
];
