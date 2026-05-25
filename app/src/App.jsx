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
  "strictMode": false
}/*EDITMODE-END*/;

function emptyProgress() {
  return { learnedPoints: new Set(), practiced: false, reportReady: false, picks: [], finalMood: null };
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = useTheme(tweaks.theme);

  // 账号 / 产品 / 路由
  const [accountId, setAccountId] = useState(ACCOUNTS[0].id);
  const [productId, setProductId] = useState(null); // null = 停在 accounts 页
  const [route, setRoute] = useState('accounts');

  // 进度按 product id 独立保存
  const [progressByProduct, setProgressByProduct] = useState({});

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
  }, []);

  // 返回到账号首页（清空产品上下文）
  const goAccounts = useCallback(() => {
    setProductId(null);
    setRoute('accounts');
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
          {route === 'home'     && product && <HomeScreen     t={t} state={currentProgress} go={go} account={account} product={product} onBackToAccounts={goAccounts} />}
          {route === 'learn'    && product && <LearningScreen t={t} state={currentProgress} setState={setCurrentProgress} go={go} highlight={highlight} product={product} />}
          {route === 'practice' && product && <PracticeScreen t={t} state={currentProgress} setState={setCurrentProgress} go={go} tweaks={tweaks} />}
          {route === 'report'   && product && <ReportScreen   t={t} state={currentProgress} go={go} />}
          {route === 'aiqa'     && product && <AIQAScreen     t={t} go={go} contextKpId={aiqaContextKp} setContextKpId={setAiqaContextKp} initialMode={aiqaInitialMode} />}
          {route === 'notes'    && product && <NotesScreen    t={t} go={go} />}
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
        }} />
      </TweaksPanel>
    </>
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
