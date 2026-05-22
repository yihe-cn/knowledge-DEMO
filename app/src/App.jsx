// App.jsx — root, routing, tweaks
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTheme } from './theme.js';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton } from './components/TweaksPanel.jsx';
import { KNOWLEDGE } from './data.js';
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

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = useTheme(tweaks.theme);
  const dark = tweaks.theme === 'dark';

  const [state, setState] = useState({
    learnedPoints: new Set(),
    practiced: false,
    reportReady: false,
    picks: [],
    finalMood: null,
  });

  const [route, setRoute] = useState('home');
  const [highlight, setHighlight] = useState(null);
  const [aiqaContextKp, setAiqaContextKp] = useState(null);
  const [aiqaInitialMode, setAiqaInitialMode] = useState('chat');

  const go = useCallback((r, opts = {}) => {
    setRoute(r);
    if (opts.highlight) setHighlight(opts.highlight);
    if (r === 'aiqa') {
      setAiqaContextKp(opts.kpId || null);
      setAiqaInitialMode(opts.mode || 'chat');
    }
  }, []);

  const pageKey = `${route}-${state.picks.length}`;

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
          {route === 'home'     && <HomeScreen     t={t} state={state} go={go} />}
          {route === 'learn'    && <LearningScreen t={t} state={state} setState={setState} go={go} highlight={highlight} />}
          {route === 'practice' && <PracticeScreen t={t} state={state} setState={setState} go={go} tweaks={tweaks} />}
          {route === 'report'   && <ReportScreen   t={t} state={state} go={go} />}
          {route === 'aiqa'     && <AIQAScreen     t={t} go={go} contextKpId={aiqaContextKp} setContextKpId={setAiqaContextKp} initialMode={aiqaInitialMode} />}
          {route === 'notes'    && <NotesScreen    t={t} go={go} />}
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
        <TweakButton label="一键学完 8 个知识点" onClick={() => {
          const all = new Set();
          KNOWLEDGE.forEach(m => m.points.forEach(p => all.add(p.id)));
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
