// app.jsx — root, routing, tweaks
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "cream",
  "mode": "guided",
  "difficulty": "normal",
  "path": "manual",
  "strictMode": false
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = useTheme(tweaks.theme);
  const dark = tweaks.theme === 'dark';

  // App state — persisted in memory
  const [state, setState] = useState({
    learnedPoints: new Set(),
    practiced: false,
    reportReady: false,
    picks: [],
    finalMood: null,
  });

  const [route, setRoute] = useState('home'); // home | learn | practice | report | aiqa
  const [highlight, setHighlight] = useState(null);
  const [aiqaContextKp, setAiqaContextKp] = useState(null); // KP id when AI QA is launched from a KP card
  const [aiqaInitialMode, setAiqaInitialMode] = useState('chat'); // 'chat' | 'quiz'

  const go = useCallback((r, opts = {}) => {
    setRoute(r);
    if (opts.highlight) setHighlight(opts.highlight);
    if (r === 'aiqa') {
      setAiqaContextKp(opts.kpId || null);
      setAiqaInitialMode(opts.mode || 'chat');
    }
    // Reset chat when leaving practice
  }, []);

  // Page-level scroll restoration
  const pageKey = `${route}-${state.picks.length}`;

  return (
    <>
      <GlobalStyle t={t} />
      <PhoneStage t={t} dark={dark}>
        <PhoneStatusBar t={t} dark={dark} />
        <div key={pageKey} style={{
          flex: 1, overflowY: route === 'practice' ? 'hidden' : 'auto',
          overflowX: 'hidden', position: 'relative',
          display: 'flex', flexDirection: 'column',
        }}>
          {route === 'home'     && <HomeScreen     t={t} state={state} go={go} />}
          {route === 'learn'    && <LearningScreen t={t} state={state} setState={setState} go={go} highlight={highlight} />}
          {route === 'practice' && <PracticeScreen t={t} state={state} setState={setState} go={go} tweaks={tweaks} />}
          {route === 'report'   && <ReportScreen   t={t} state={state} go={go} />}
          {route === 'aiqa'     && <AIQAScreen     t={t} go={go} contextKpId={aiqaContextKp} setContextKpId={setAiqaContextKp} initialMode={aiqaInitialMode} />}
          {route === 'notes'    && <NotesScreen    t={t} go={go} />}
        </div>
        {/* Home indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 10px' }}>
          <div style={{ width: 134, height: 5, borderRadius: 999, background: t.text, opacity: 0.85 }} />
        </div>
      </PhoneStage>

      {/* Tweaks */}
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
        <TweakButton label="一键学完 8 个知识点" onClick={() => {
          const all = new Set();
          window.SIMUGO_DATA.KNOWLEDGE.forEach(m => m.points.forEach(p => all.add(p.id)));
          setState(s => ({ ...s, learnedPoints: all }));
        }} />
        <TweakButton label="重置进度" onClick={() => {
          setState({ learnedPoints: new Set(), practiced: false, reportReady: false, picks: [], finalMood: null });
          setRoute('home');
        }} />
      </TweaksPanel>
    </>
  );
}

// ─── Phone stage — centers + frames the design ───────────────
function PhoneStage({ t, dark, children }) {
  // Responsive: full screen on mobile-width, framed on desktop
  return (
    <div style={{
      minHeight: '100vh',
      background: dark
        ? `radial-gradient(ellipse at top, #2A2D36 0%, #14161B 60%)`
        : tweaks_bgGradient(t),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: 'min(420px, 100%)',
        height: 'min(900px, calc(100vh - 40px))',
        background: t.bg,
        borderRadius: 44,
        position: 'relative',
        boxShadow: dark
          ? '0 30px 60px rgba(0,0,0,0.6), 0 0 0 12px #0a0b0e, 0 0 0 14px #1F2128'
          : `0 30px 60px rgba(60,50,30,0.18), 0 0 0 12px ${t.text}, 0 0 0 14px #555`,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit',
        color: t.text,
      }}>
        {/* Notch */}
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          width: 110, height: 30, background: '#0a0b0e', borderRadius: 999, zIndex: 100,
        }} />
        {children}
      </div>
    </div>
  );
}

function tweaks_bgGradient(t) {
  if (t === window.THEMES?.slate || t.bg === '#E4E7ED') {
    return `radial-gradient(ellipse at 30% 20%, #F0F2F7 0%, #C8CDD8 100%)`;
  }
  return `radial-gradient(ellipse at 30% 20%, #F4EFE3 0%, #C9C0AD 100%)`;
}

function GlobalStyle({ t }) {
  return <style>{`
    *, *::before, *::after { box-sizing: border-box; }
    html, body, #root { margin: 0; padding: 0; height: 100%; font-family: 'PingFang SC', 'Hiragino Sans', -apple-system, 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; }
    body { background: #1a1a1a; }
    button { font-family: inherit; }
    *::-webkit-scrollbar { width: 0; height: 0; }
    * { scrollbar-width: none; }
  `}</style>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
