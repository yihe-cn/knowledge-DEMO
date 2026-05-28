// App.jsx — root, routing, tweaks
// 顶层路由：accounts(我的课程) → home(学练评) → learn/practice/report/aiqa/notes
// 多产品状态：progressByProduct 按产品 id 独立保存学习/演练/评估进度
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTheme } from './theme.js';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton } from './components/TweaksPanel.jsx';
import {
  ACCOUNTS,
  ACCOUNT_INDEX,
  PRODUCTS,
  getAccount,
  registerLearnerAccount,
  setActiveProduct,
  loadRemoteProducts,
  ensureProductLoaded,
  getVisibleProductIds,
} from './productCatalog.js';
import { AccountHome } from './screens/AccountHome.jsx';
import { HomeScreen, LearningScreen } from './screens/HomeLearn.jsx';
import { PracticeScreen } from './screens/Practice.jsx';
import { ReportScreen } from './screens/Report.jsx';
import { AIQAScreen } from './screens/AIQA.jsx';
import { NotesScreen } from './screens/Notes.jsx';
import { AssessmentScreen } from './screens/Assessment.jsx';
import LoginScreen from './screens/Login.jsx';

const AUTH_STORAGE_KEY = 'simugo:auth:v1';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "cream",
  "mode": "guided",
  "difficulty": "normal",
  "path": "manual",
  "strictMode": false,
  "showStageTiming": false
}/*EDITMODE-END*/;

function emptyProgress() {
  return { learnedPoints: new Set(), practiced: false, reportReady: false, picks: [], finalMood: null };
}

// 进度持久化（S3）：演示场景用 sessionStorage 即可——关闭浏览器自然清，
// 但刷新/接电话回来续场不丢。Set 不能直接 JSON 序列化，走 Array 兜底。
const PROGRESS_STORAGE_KEY = 'simugo:progressByProduct:v1';
function serializeProgress(byProduct) {
  const out = {};
  for (const [pid, p] of Object.entries(byProduct)) {
    out[pid] = { ...p, learnedPoints: Array.from(p.learnedPoints || []) };
  }
  return out;
}
function deserializeProgress(raw) {
  const out = {};
  for (const [pid, p] of Object.entries(raw || {})) {
    out[pid] = {
      ...emptyProgress(),
      ...p,
      learnedPoints: new Set(Array.isArray(p.learnedPoints) ? p.learnedPoints : []),
    };
  }
  return out;
}
function loadProgressFromSession() {
  try {
    const raw = sessionStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    return deserializeProgress(JSON.parse(raw));
  } catch (e) {
    console.warn('[App] load progress from session failed:', e);
    return {};
  }
}
function saveProgressToSession(byProduct) {
  try {
    sessionStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(serializeProgress(byProduct)));
  } catch (e) {
    console.warn('[App] save progress to session failed:', e);
  }
}

// 深链支持（S1）：?account=xx&product=yy 直达 HomeLearn，
// 同时切换账号/课程时把当前状态回写到 URL，便于销售保存"演示开场链接"。
const DEEP_LINK_ROUTES = new Set(['home', 'learn', 'practice', 'aiqa', 'notes']);
const URL_ROUTE_STATES = new Set(['learn', 'practice', 'aiqa', 'notes']);

function readUrlParams() {
  if (typeof window === 'undefined') return { account: null, product: null, route: null };
  const sp = new URLSearchParams(window.location.search);
  const route = sp.get('route');
  return {
    account: sp.get('account'),
    product: sp.get('product'),
    route: DEEP_LINK_ROUTES.has(route) ? route : null,
  };
}
function writeUrlParams({ account, product, route = null }) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (account) sp.set('account', account); else sp.delete('account');
  if (product) sp.set('product', product); else sp.delete('product');
  if (route && URL_ROUTE_STATES.has(route)) sp.set('route', route); else sp.delete('route');
  const qs = sp.toString();
  const newUrl = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
  window.history.replaceState(null, '', newUrl);
}

// 考核分支：URL 带 ?token=xxx 直接进考核屏，跳过账号/课程主流程。
// 在 App 外面做分流，保持主 App 内部的 hooks 顺序稳定。
function AppRoot() {
  const hasAssessmentToken = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('token');
  const [authed, setAuthed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return sessionStorage.getItem(AUTH_STORAGE_KEY) === '1'; } catch { return false; }
  });
  const t = useTheme('cream');
  const logout = useCallback(() => {
    try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
    setAuthed(false);
  }, []);
  if (hasAssessmentToken) return <AssessmentScreen />;
  if (!authed) {
    return (
      <>
        <GlobalStyle t={t} />
        <div style={{
          width: '100%', height: '100dvh',
          background: t.bg, color: t.text,
          display: 'flex', flexDirection: 'column',
          fontFamily: 'inherit', overflow: 'hidden',
          paddingTop: 'env(safe-area-inset-top)',
        }}>
          <LoginScreen
            t={t}
            onLogin={() => {
              try { sessionStorage.setItem(AUTH_STORAGE_KEY, '1'); } catch {}
              setAuthed(true);
            }}
          />
        </div>
      </>
    );
  }
  return <MainApp onLogout={logout} />;
}

function MainApp({ onLogout }) {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = useTheme(tweaks.theme);

  // 账号 / 产品 / 路由：URL 参数优先
  // product 参数不在此校验合法性——switchProduct 会走 ensureProductLoaded，
  // 不存在/加载失败时本身已有兜底（alert + 留在 accounts），同时允许远端动态产品
  const initial = useMemo(() => {
    const { account, product, route } = readUrlParams();
    if (account && !ACCOUNT_INDEX[account]) registerLearnerAccount(account);
    const accountId = account || ACCOUNTS[0].id;
    return { accountId, productId: product || null, route: route || 'home' };
  }, []);

  const [accountId, setAccountId] = useState(initial.accountId);
  const [productId, setProductId] = useState(null); // 真正的 productId 在下方 useEffect 里激活
  const [route, setRoute] = useState('accounts');

  // 进度按 product id 独立保存（启动时从 sessionStorage 恢复）
  const [progressByProduct, setProgressByProduct] = useState(loadProgressFromSession);

  // 任意 progress 变化都同步回 sessionStorage
  useEffect(() => { saveProgressToSession(progressByProduct); }, [progressByProduct]);

  // 远端课程列表按账号分发加载；加载完成后触发 AccountHome 重新渲染
  const [remoteLoaded, setRemoteLoaded] = useState(0);
  const initialProductRef = useRef(initial.productId);
  const initialRouteRef = useRef(initial.route);
  useEffect(() => {
    loadRemoteProducts(accountId).then(() => {
      setRemoteLoaded(n => n + 1);
      const pid = initialProductRef.current;
      const route = initialRouteRef.current;
      initialProductRef.current = null;
      initialRouteRef.current = null;
      if (pid) switchProduct(pid, { route });
    });
  }, []); // 首次账号来自 URL 初始化值，后续账号切换在 switchAccount 内刷新

  // 路由附带参数
  const [highlight, setHighlight] = useState(null);
  const [aiqaContextKp, setAiqaContextKp] = useState(null);
  const [aiqaInitialMode, setAiqaInitialMode] = useState('chat');
  // route='assessment' 时携带的 token；从 AccountHome / HomeScreen 进入时由 go() 注入
  const [examToken, setExamToken] = useState(null);

  // 当前产品的 progress（如果还没有就给空）
  const currentProgress = productId ? (progressByProduct[productId] || emptyProgress()) : emptyProgress();

  // 给子组件用的 setState：仅更新当前产品的进度切片
  const setCurrentProgress = useCallback((updater) => {
    if (!productId) return;
    setProgressByProduct(prev => {
      const before = prev[productId] || emptyProgress();
      const next = typeof updater === 'function' ? updater(before) : updater;
      return { ...prev, [productId]: next };
    });
  }, [productId]);

  const go = useCallback((r, opts = {}) => {
    setRoute(r);
    if (opts.highlight) setHighlight(opts.highlight);
    if (r === 'aiqa') {
      setAiqaContextKp(opts.kpId || null);
      setAiqaInitialMode(opts.mode || 'chat');
    }
    if (r === 'assessment') {
      setExamToken(opts.token || null);
    }
    writeUrlParams({
      account: accountId,
      product: productId,
      route: URL_ROUTE_STATES.has(r) ? r : null,
    });
  }, [accountId, productId]);

  // 切换账号：回到该账号的 accounts 页，清空产品上下文
  const switchAccount = useCallback((aid) => {
    setAccountId(aid);
    setProductId(null);
    setRoute('accounts');
    writeUrlParams({ account: aid, product: null });
    loadRemoteProducts(aid).then(() => setRemoteLoaded(n => n + 1));
  }, []);

  // 切换产品：异步加载（远端产品首次进入会拉详情），再注入 window.SIMUGO_DATA
  // 用 ref 跟踪最新一次请求，避免快速连点时先发起的请求后返回覆盖新选择
  const switchSeqRef = useRef(0);
  const switchProduct = useCallback(async (pid, opts = {}) => {
    if (!PRODUCTS[pid]) return;
    const visibleIds = getVisibleProductIds(getAccount(accountId));
    if (!visibleIds.includes(pid)) {
      alert('该课程尚未分发给当前学员，或课程访问已被停止。');
      setProductId(null);
      setRoute('accounts');
      writeUrlParams({ account: accountId, product: null });
      return;
    }
    const seq = ++switchSeqRef.current;
    try {
      await ensureProductLoaded(pid);
    } catch (e) {
      console.warn('[App] load product failed:', pid, e);
      if (seq === switchSeqRef.current) {
        alert(`加载课程失败：${pid}\n${e.message || e}`);
      }
      return;
    }
    if (seq !== switchSeqRef.current) return; // 已被更晚的请求取代
    await setActiveProduct(pid);
    if (seq !== switchSeqRef.current) return;
    const nextRoute = DEEP_LINK_ROUTES.has(opts.route) ? opts.route : 'home';
    setProductId(pid);
    setRoute(nextRoute);
    setProgressByProduct(prev => prev[pid] ? prev : { ...prev, [pid]: emptyProgress() });
    writeUrlParams({
      account: accountId,
      product: pid,
      route: URL_ROUTE_STATES.has(nextRoute) ? nextRoute : null,
    });
  }, [accountId]);

  // 返回到账号首页（清空产品上下文）
  const goAccounts = useCallback(() => {
    setProductId(null);
    setRoute('accounts');
    writeUrlParams({ account: accountId, product: null });
  }, [accountId]);

  // 当前账号 & 产品
  const account = getAccount(accountId);
  const product = productId ? PRODUCTS[productId] : null;

  // Keep the page mounted when practice commits picks into product progress.
  // Remounting on picks length reset the finished screen before users could open the report.
  const pageKey = `${route}-${productId || 'none'}`;

  return (
    <>
      <GlobalStyle t={t} />
      <div style={{
        width: '100%', height: '100dvh',
        background: t.bg, color: t.text,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit', overflow: 'hidden',
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        <div key={pageKey} style={{
          flex: 1, overflowY: route === 'practice' ? 'hidden' : 'auto',
          overflowX: 'hidden', position: 'relative',
          display: 'flex', flexDirection: 'column',
        }}>
          {route === 'accounts' && (
            <AccountHome
              t={t}
              accountId={accountId}
              switchAccount={switchAccount}
              switchProduct={switchProduct}
              progressByProduct={progressByProduct}
              go={go}
              onLogout={onLogout}
            />
          )}
          {route === 'home'     && product && <HomeScreen     t={t} state={currentProgress} setState={setCurrentProgress} go={go} account={account} product={product} onBackToAccounts={goAccounts} switchProduct={switchProduct} />}
          {route === 'learn'    && product && <LearningScreen t={t} state={currentProgress} setState={setCurrentProgress} go={go} highlight={highlight} product={product} account={account} />}
          {route === 'practice' && product && <PracticeScreen t={t} state={currentProgress} setState={setCurrentProgress} go={go} tweaks={tweaks} />}
          {route === 'report'   && product && <ReportScreen   t={t} state={currentProgress} go={go} />}
          {route === 'aiqa'     && product && <AIQAScreen     t={t} go={go} contextKpId={aiqaContextKp} setContextKpId={setAiqaContextKp} initialMode={aiqaInitialMode} tweaks={tweaks} />}
          {route === 'notes'    && product && <NotesScreen    t={t} go={go} />}
          {route === 'assessment' && examToken && (
            <AssessmentScreen
              t={t}
              token={examToken}
              onBack={() => { setExamToken(null); go(productId ? 'home' : 'accounts'); }}
            />
          )}

          {/* 浮动私教入口：learn 用内联按钮，home 有 AIAssistantBanner，两者均不再叠加浮动按钮 */}
          {product && !['practice', 'aiqa', 'accounts', 'assessment', 'learn', 'home'].includes(route) && (
            <FloatingTutor t={t} onClick={() => go('aiqa')} />
          )}
        </div>
      </div>

      <TweaksPanel>
        <TweakSection label="主题" />
        <TweakRadio label="风格" value={tweaks.theme}
          options={['cream', 'slate', 'dark']}
          onChange={(v) => setTweak('theme', v)} />
        <TweakSection label="演练交互" />
        <TweakRadio label="形态" value={tweaks.mode}
          options={['guided', 'open']}
          onChange={(v) => setTweak('mode', v)} />
        <TweakRadio label="客户难度" value={tweaks.difficulty}
          options={['gentle', 'normal', 'tough']}
          onChange={(v) => setTweak('difficulty', v)} />
        <TweakRadio label="演示走向" value={tweaks.path}
          options={['manual', 'good', 'bad']}
          onChange={(v) => setTweak('path', v)} />
        <TweakToggle label="严苛模式（无弹药提示）" value={tweaks.strictMode}
          onChange={(v) => setTweak('strictMode', v)} />
        <TweakSection label="研发调试" />
        <TweakToggle label="显示 AI 答疑阶段耗时（dev）" value={tweaks.showStageTiming}
          onChange={(v) => setTweak('showStageTiming', v)} />
        <TweakSection label="快捷" />
        <TweakButton label="一键学完当前产品全部知识点" onClick={() => {
          if (!product) return;
          const all = new Set();
          product.knowledge.forEach(m => m.points.forEach(p => all.add(p.id)));
          setCurrentProgress(s => ({ ...s, learnedPoints: all }));
        }} />
        <TweakButton label="重置全部进度" onClick={() => {
          setProgressByProduct({});
          setProductId(null);
          setRoute('accounts');
          writeUrlParams({ account: null, product: null });
        }} />
      </TweaksPanel>
    </>
  );
}


// report/notes 屏的常驻私教入口：纯图标辨识度低，改为带文字的 pill 提升视觉引导。
// learn 屏改用内联锚定按钮；home 屏已有 AIAssistantBanner，两者均不再叠加此浮动按钮。
function FloatingTutor({ t, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', right: 18, bottom: 88, zIndex: 30,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '11px 16px 11px 12px',
        borderRadius: 999,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        cursor: 'pointer',
        boxShadow: `4px 4px 12px ${t.sDark}, -3px -3px 8px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 0 ${t.accent}55`,
        animation: 'simugoTutorPulse 2.4s ease-in-out infinite',
      }}
      title="问 AI 私教"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.01em' }}>问 AI 私教</span>
      <style>{`
        @keyframes simugoTutorPulse {
          0%, 100% { box-shadow: 4px 4px 12px ${t.sDark}, -3px -3px 8px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 0 ${t.accent}55; }
          50%      { box-shadow: 4px 4px 12px ${t.sDark}, -3px -3px 8px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 10px ${t.accent}00; }
        }
      `}</style>
    </div>
  );
}

function GlobalStyle({ t }) {
  return <style>{`
    *, *::before, *::after { box-sizing: border-box; }
    html, body, #root { margin: 0; padding: 0; height: 100%; font-family: 'PingFang SC', 'Hiragino Sans', -apple-system, 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; }
    body { background: ${t.bg}; }
    button { font-family: inherit; }
    *::-webkit-scrollbar { width: 0; height: 0; }
    * { scrollbar-width: none; }
  `}</style>;
}

export default AppRoot;
