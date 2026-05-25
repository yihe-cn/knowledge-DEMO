import { ReactNode, useRef } from 'react';
import { STATUS_LABEL } from '../data';
import { I } from '../icons';
import { useUploadDoc } from '../api';
import { useActiveProduct } from '../../context/ActiveProduct';

export function Pill({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className={'pill ' + status}>
      <span className="dot" />
      {children || STATUS_LABEL[status] || status}
    </span>
  );
}

export function PageHeader({
  crumbs, title, desc, actions,
}: {
  crumbs?: ReactNode[]; title: ReactNode; desc?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {crumbs && (
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="sep">/</span>}
                {c}
              </span>
            ))}
          </div>
        )}
        <h1 className="h1">{title}</h1>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function UploadDocButton({
  className = 'btn primary',
  label = '导入文件',
  showIcon = true,
}: {
  className?: string;
  label?: ReactNode;
  showIcon?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDoc();
  const { productId, products, loading } = useActiveProduct();

  const onClick = () => {
    if (!productId) {
      const hint = products.length === 0
        ? '请先在系统中创建产品后再导入文件'
        : '请先在顶栏选择"归属产品"后再导入文件';
      alert(hint);
      return;
    }
    inputRef.current?.click();
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !productId) return;
    upload.mutate(
      { file: f, productId },
      {
        onSuccess: () => alert(`上传成功：${f.name}，后台处理中`),
        onError: (err: any) =>
          alert('上传失败：' + (err?.response?.data?.detail || err?.message || '未知错误')),
      },
    );
  };

  return (
    <>
      <button
        className={className}
        onClick={onClick}
        disabled={loading || upload.isPending}
        title={productId ? '导入制度文件' : '请先选择归属产品'}
      >
        {showIcon && <I.Upload />}
        {upload.isPending ? '上传中…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.pptx,.md,.txt"
        style={{ display: 'none' }}
        onChange={onChange}
      />
    </>
  );
}
