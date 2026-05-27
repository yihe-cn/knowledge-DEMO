import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { Sidebar, Topbar, CommandPalette } from './components/Shell';
import Dashboard from '../pages/Dashboard';
import KpRegistry from '../pages/KpRegistry';
import KpDetail from '../pages/KpDetail';
import KbDocuments from '../pages/KbDocuments';
import KpReview from '../pages/KpReview';
import Insights from './pages/Insights';
import Audit from './pages/Audit';
import { TaxonomyPage, DeptsPage, ConfigPage } from './pages/Placeholder';
import Assessments from '../pages/Assessments';
import AssessmentEditor from '../pages/AssessmentEditor';
import Assignments from '../pages/Assignments';
import AssessmentStats from '../pages/AssessmentStats';
import Courses from '../pages/Courses';
import { useOverview, useDocs } from './api';

function routeFromPath(p: string): string {
  if (p === '/hr' || p === '/hr/') return 'overview';
  const parts = p.replace(/^\/hr\/?/, '').split('/');
  const seg = parts[0];
  if (seg === 'items') return 'library';
  if (seg === 'assessments') {
    if (parts[1] === 'assignments') return 'assignments';
    if (parts[1] === 'stats') return 'stats';
    return 'assessments';
  }
  if (seg === 'products') return 'courses';
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
            <Route index                              element={<Dashboard />} />
            <Route path="library"                     element={<KpRegistry />} />
            <Route path="items/:id"                   element={<KpDetail />} />
            <Route path="docs"                        element={<KbDocuments />} />
            <Route path="taxonomy"                    element={<TaxonomyPage />} />
            <Route path="review"                      element={<KpReview />} />
            <Route path="insights"                    element={<Insights />} />
            <Route path="audit"                       element={<Audit />} />
            <Route path="assessments"                 element={<Assessments />} />
            <Route path="assessments/assignments"     element={<Assignments />} />
            <Route path="assessments/stats"           element={<AssessmentStats />} />
            <Route path="assessments/:id/edit"        element={<AssessmentEditor />} />
            <Route path="courses"                     element={<Courses />} />
            <Route path="courses/:id"                 element={<Courses />} />
            <Route path="products"                    element={<Courses />} />
            <Route path="depts"                       element={<DeptsPage />} />
            <Route path="config"                      element={<ConfigPage />} />
          </Routes>
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
