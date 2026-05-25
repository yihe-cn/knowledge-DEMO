import { ReactNode } from 'react';
import { PageHeader } from '../components/primitives';

export function Placeholder({
  crumbs, title, desc, todo,
}: {
  crumbs: ReactNode[]; title: string; desc: string; todo: string[];
}) {
  return (
    <>
      <PageHeader crumbs={crumbs} title={title} desc={desc} />
      <div className="card" style={{ textAlign: 'left', padding: 32 }}>
        <div style={{
          display: 'inline-flex', padding: '4px 10px', borderRadius: 999,
          background: 'var(--accent-soft)', color: 'var(--accent)',
          fontSize: 11, fontFamily: 'var(--ff-mono)', marginBottom: 16,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>暂未接入后端</div>
        <h2 className="h2" style={{ marginBottom: 8 }}>本页会包含</h2>
        <ul style={{ paddingLeft: 18, color: 'var(--ink-2)', lineHeight: 1.8, margin: 0 }}>
          {todo.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </div>
    </>
  );
}

export const TaxonomyPage = () => <Placeholder
  crumbs={['知识维护', '分类与标签']}
  title="分类与标签"
  desc="维护一级分类（8 个）、二级分类、标签词典与同义词，让员工的不同问法都能命中同一条目。"
  todo={[
    '树形编辑器：一级分类（不可删）+ 二级 + 自定义标签',
    '同义词字典：例如「年假 ≡ 年休假 ≡ 带薪假」',
    '标签使用热度图：低频标签可清理',
    '命名规范校验：禁止同义/同名/拼写不一致',
  ]}
/>;

export const DeptsPage = () => <Placeholder
  crumbs={['设置', '组织与成员']}
  title="组织与成员"
  desc="管理部门 / 职级矩阵、HRBP 归口范围、审核人角色。决定知识条目可由谁维护、对谁可见。"
  todo={[
    '部门树 + 职级序列（双轴）',
    'HRBP 归口矩阵：谁负责哪些分类',
    '审核工作流配置：草稿 → 审核 → 复核 → 发布',
    '角色权限：HR Admin / HRBP / 部门接口人 / 法务',
  ]}
/>;

export const ConfigPage = () => <Placeholder
  crumbs={['设置', '系统配置']}
  title="系统配置"
  desc="抽取模型与切片策略、HRBot 提示词、外部数据源（HRIS、考勤、合同）对接配置。"
  todo={[
    '抽取流水线：切片大小、相似度阈值、模型版本',
    'HRBot 行为：是否引用条目、是否拒答未授权信息',
    '外部数据源：HRIS / 考勤 / 合同库 的 Webhook',
    '通知策略：失效预警、SLA 提醒、订阅式日报',
  ]}
/>;
