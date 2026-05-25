import { useState } from 'react';
import { Layout, Menu, Button, Input, Modal, message, Select, Space } from 'antd';
import { Link, Route, Routes, useLocation, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import KbDocuments from './pages/KbDocuments';
import KpReview from './pages/KpReview';
import KpRegistry from './pages/KpRegistry';
import KpDetail from './pages/KpDetail';
import Products from './pages/Products';
import HrApp from './hr/HrApp';
import { setInternalToken } from './api/client';
import { ActiveProductProvider, useActiveProduct } from './context/ActiveProduct';

const { Header, Sider, Content } = Layout;

const items = [
  { key: '/dashboard', label: <Link to="/dashboard">仪表盘</Link> },
  { key: '/products', label: <Link to="/products">产品管理</Link> },
  { key: '/kb', label: <Link to="/kb">KB 文档</Link> },
  { key: '/kp/review', label: <Link to="/kp/review">KP 审核</Link> },
  { key: '/kp', label: <Link to="/kp">KP 全量</Link> },
  { key: '/hr', label: <Link to="/hr">HR 知识中台</Link> },
];

function ProductSwitcher() {
  const { productId, setProductId, products, loading } = useActiveProduct();
  return (
    <Select
      style={{ width: 200 }}
      placeholder="全部产品"
      allowClear
      loading={loading}
      value={productId ?? undefined}
      onChange={(v) => setProductId(v ?? null)}
      options={products.map((p) => ({ label: `${p.name} (${p.code})`, value: p.id }))}
    />
  );
}

function Shell() {
  const loc = useLocation();
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenValue, setTokenValue] = useState(localStorage.getItem('internalToken') || '');

  const selectedKey =
    items
      .map((i) => i.key)
      .filter((k) => loc.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] || '/dashboard';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', color: '#fff', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>SIMUGO 管理后台</div>
        <Space>
          <ProductSwitcher />
          <Button size="small" onClick={() => setTokenOpen(true)}>
            Internal Token
          </Button>
        </Space>
      </Header>
      <Layout>
        <Sider width={180} theme="light">
          <Menu mode="inline" selectedKeys={[selectedKey]} items={items} style={{ height: '100%' }} />
        </Sider>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/kb" element={<KbDocuments />} />
            <Route path="/kp/review" element={<KpReview />} />
            <Route path="/kp" element={<KpRegistry />} />
            <Route path="/kp/:id" element={<KpDetail />} />
          </Routes>
        </Content>
      </Layout>

      <Modal
        title="设置 Internal Token"
        open={tokenOpen}
        onCancel={() => setTokenOpen(false)}
        onOk={() => {
          setInternalToken(tokenValue);
          setTokenOpen(false);
          message.success('已保存，刷新后生效');
        }}
      >
        <Input.Password
          value={tokenValue}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="server 的 INTERNAL_TOKEN；开发模式留空即可"
        />
      </Modal>
    </Layout>
  );
}

export default function App() {
  return (
    <ActiveProductProvider>
      <Routes>
        <Route path="/hr/*" element={<HrApp />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </ActiveProductProvider>
  );
}
