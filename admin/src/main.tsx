import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// HR 设计 token → antd theme 映射，让 antd 组件穿 HR 的衣服
const hrTheme = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#20355C',
    colorInfo: '#345E80',
    colorSuccess: '#28614A',
    colorWarning: '#8A5A1E',
    colorError: '#8E2A2A',

    colorBgBase: '#FFFFFF',
    colorBgLayout: '#F6F2EA',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',

    colorText: '#1A1B23',
    colorTextSecondary: '#3B3D48',
    colorTextTertiary: '#76716A',
    colorTextQuaternary: '#9A9588',

    colorBorder: '#E2DBC8',
    colorBorderSecondary: '#ECE6D4',

    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,

    fontFamily: '"Geist", "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif',
    fontFamilyCode: '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
    fontSize: 14,
  },
  components: {
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary: '0 1px 0 rgba(26,27,35,0.04), 0 4px 12px rgba(26,27,35,0.06)',
      headerBg: 'transparent',
    },
    Table: {
      headerBg: '#FBF8F1',
      headerColor: '#3B3D48',
      headerSplitColor: '#ECE6D4',
      borderColor: '#ECE6D4',
      rowHoverBg: '#FBF8F1',
    },
    Button: {
      borderRadius: 8,
      controlHeight: 32,
    },
    Tag: {
      borderRadiusSM: 4,
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#E6EAF2',
      itemSelectedColor: '#20355C',
    },
    Layout: {
      bodyBg: '#F6F2EA',
      headerBg: '#FFFFFF',
      siderBg: '#FBF8F1',
    },
    Modal: {
      borderRadiusLG: 12,
    },
    Input: {
      borderRadius: 8,
    },
    Select: {
      borderRadius: 8,
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={hrTheme}>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
