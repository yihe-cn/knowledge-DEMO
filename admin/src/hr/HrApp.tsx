import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { Sidebar, Topbar, CommandPalette } from './components/Shell';
import Overview from './pages/Overview';
import Library from './pages/Library';
import ItemDetail from './pages/ItemDetail';
import Review from './pages/Review';
import Insights from './pages/Insights';
import Docs from './pages/Docs';
import Audit from './pages/Audit';
import { TaxonomyPage, DeptsPage, ConfigPage } from './pages/Placeholder';
import { useOverview, useDocs } from './api';

function routeFromPath(p: string): string {
  if (p === '/hr' || p === '/hr/') return 'overview';
  const seg = p.replace(/^\/hr\//, '').split('/')[0];
  if (seg === 'items') return 'item';
  return seg || 'overview';
}

export default function HrApp() {
  const loc = useLocation();
  const route = routeFromPath(loc.pathname);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const ov = useOverview();
  const docs = useDocs();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const counts = {
    items: ov.data?.kp_total ?? 0,
    docs: docs.data?.total ?? 0,
    review: ov.data?.pending_review ?? 0,
  };

  return (
    <div className="hr-app"
         data-theme="navy"
         data-density="comfortable"
         data-side={collapsed ? 'collapsed' : 'expanded'}>
      <div className="shell">
        <Topbar onOpenCmd={() => setCmdOpen(true)} />
        <Sidebar
          route={route}
          counts={counts}
          collapsed={collapsed}
          onToggle={() => setCollapsed(c => !c)}
        />
        <main className="main">
          <Routes>
            <Route index            element={<Overview />} />
            <Route path="library"   element={<Library />} />
            <Route path="items/:id" element={<ItemDetail />} />
            <Route path="review"    element={<Review />} />
            <Route path="insights"  element={<Insights />} />
            <Route path="docs"      element={<Docs />} />
            <Route path="taxonomy"  element={<TaxonomyPage />} />
            <Route path="audit"     element={<Audit />} />
            <Route path="depts"     element={<DeptsPage />} />
            <Route path="config"    element={<ConfigPage />} />
          </Routes>
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
