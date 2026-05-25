// App.jsx — root, routing, tweaks
// 顶层路由：accounts(我的课程) → home(学练评) → learn/practice/report/aiqa/notes
// 多产品状态：progressByProduct 按产品 id 独立保存学习/演练/评估进度
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTheme } from './theme.js';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton } from './components/TweaksPanel.jsx';
import { ACCOUNTS, ACCOUNT_INDEX, PRODUCTS, setActiveProduct, loadRemoteProducts, ensureProductLoaded } from './productCatalog.js';
import { AccountHome } from './screens/AccountHome.jsx';
import { HomeScreen, LearningScreen } from './screens/HomeLearn.jsx';
import { PracticeScreen } from './screens/Practice.jsx';
import { ReportScreen } from './screens/Report.jsx';
import { AIQAScreen } from './screens/AIQA.jsx';
import { NotesScreen } from './screens/Notes.jsx';

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
function readUrlParams() {
  if (typeof window === 'undefined') return { account: null, product: null };
  const sp = new URLSearchParams(window.location.search);
  return {
    account: sp.get('account'),
    product: sp.get('product'),
  };
}
function writeUrlParams({ account, product }) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (account) sp.set('account', account); else sp.delete('account');
  if (product) sp.set('product', product); else sp.delete('product');
  const qs = sp.toString();
  const newUrl = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
  window.history.replaceState(null, '', newUrl);
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = useTheme(tweaks.theme);

  // 账号 / 产品 / 路由：URL 参数优先
  // product 参数不在此校验合法性——switchProduct 会走 ensureProductLoaded，
  // 不存在/加载失败时本身已有兜底（alert + 留在 accounts），同时允许远端动态产品
  const initial = useMemo(() => {
    const { account, product } = readUrlParams();
    const accountId = (account && ACCOUNT_INDEX[account]) ? account : ACCOUNTS[0].id;
    return { accountId, productId: product || null };
  }, []);

  const [accountId, setAccountId] = useState(initial.accountId);
  const [productId, setProductId] = useState(null); // 真正的 productId 在下方 useEffect 里激活
  const [route, setRoute] = useState('accounts');

  // 进度按 product id 独立保存（启动时从 sessionStorage 恢复）
  const [progressByProduct, setProgressByProduct] = useState(loadProgressFromSession);

  // 任意 progress 变化都同步回 sessionStorage
  useEffect(() => { saveProgressToSession(progressByProduct); }, [progressByProduct]);

  // 远端产品列表（admin 创建的产品）加载完后触发一次 re-render
  const [remoteLoaded, setRemoteLoaded] = useState(0);
  useEffect(() => {
    loadRemoteProducts().then(ids => {
      if (ids.length) setRemoteLoaded(n => n + 1);
    });
  }, []);

  // 路由附带参数
  const [highlight, setHighlight] = useState(null);
  const [aiqaContextKp, setAiqaContextKp] = useState(null);
  const [aiqaInitialMode, setAiqaInitialMode] = useState('chat');

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
  }, []);

  // 切换账号：回到该账号的 accounts 页，清空产品上下文
  const switchAccount = useCallback((aid) => {
    setAccountId(aid);
    setProductId(null);
    setRoute('accounts');
    writeUrlParams({ account: aid, product: null });
  }, []);

  // 切换产品：异步加载（远端产品首次进入会拉详情），再注入 window.SIMUGO_DATA
  // 用 ref 跟踪最新一次请求，避免快速连点时先发起的请求后返回覆盖新选择
  const switchSeqRef = useRef(0);
  const switchProduct = useCallback(async (pid) => {
    if (!PRODUCTS[pid]) return;
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
    setProductId(pid);
    setRoute('home');
    setProgressByProduct(prev => prev[pid] ? prev : { ...prev, [pid]: emptyProgress() });
    writeUrlParams({ account: accountId, product: pid });
  }, [accountId]);

  // 返回到账号首页（清空产品上下文）
  const goAccounts = useCallback(() => {
    setProductId(null);
    setRoute('accounts');
    writeUrlParams({ account: accountId, product: null });
  }, [accountId]);

  // 启动时若 URL 带了合法的 product，自动激活并跳到 home
  const initialProductRef = useRef(initial.productId);
  useEffect(() => {
    const pid = initialProductRef.current;
    if (pid) switchProduct(pid);
    // 仅在挂载时跑一次；switchProduct 依赖 accountId（来自 URL 已就位）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当前账号 & 产品
  const account = ACCOUNT_INDEX[accountId];
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
            />
          )}
          {route === 'home'     && product && <HomeScreen     t={t} state={currentProgress} go={go} account={account} product={product} onBackToAccounts={goAccounts} switchProduct={switchProduct} />}
          {route === 'learn'    && product && <LearningScreen t={t} state={currentProgress} setState={setCurrentProgress} go={go} highlight={highlight} product={product} />}
          {route === 'practice' && product && <PracticeScreen t={t} state={currentProgress} setState={setCurrentProgress} go={go} tweaks={tweaks} />}
          {route === 'report'   && product && <ReportScreen   t={t} state={currentProgress} go={go} />}
          {route === 'aiqa'     && product && <AIQAScreen     t={t} go={go} contextKpId={aiqaContextKp} setContextKpId={setAiqaContextKp} initialMode={aiqaInitialMode} tweaks={tweaks} />}
          {route === 'notes'    && product && <NotesScreen    t={t} go={go} />}

          {/* S10：全局浮动私教入口——除 practice/aiqa/accounts 外都显示 */}
          {product && !['practice', 'aiqa', 'accounts'].includes(route) && (
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


// S10：右下角常驻私教按钮。位置 fixed，避开底部 BottomCTA 时的滚动条；
// 仅在 home/learn/report/notes 显示——practice 是沉浸态，aiqa 自己就是目的地。
function FloatingTutor({ t, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', right: 18, bottom: 22, zIndex: 30,
        width: 56, height: 56, borderRadius: 999,
        background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: `5px 5px 14px ${t.sDark}, -4px -4px 10px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 0 ${t.accent}55`,
        animation: 'simugoTutorPulse 2.4s ease-in-out infinite',
      }}
      title="问 AI 私教"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      </svg>
      <style>{`
        @keyframes simugoTutorPulse {
          0%, 100% { box-shadow: 5px 5px 14px ${t.sDark}, -4px -4px 10px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 0 ${t.accent}55; }
          50%      { box-shadow: 5px 5px 14px ${t.sDark}, -4px -4px 10px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 10px ${t.accent}00; }
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

export default App;
