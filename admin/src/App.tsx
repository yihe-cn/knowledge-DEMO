import { Navigate, Route, Routes } from 'react-router-dom';
import HrApp from './hr/HrApp';
import { ActiveProductProvider } from './context/ActiveProduct';

export default function App() {
  return (
    <ActiveProductProvider>
      <Routes>
        <Route path="/hr/*" element={<HrApp />} />
        <Route path="*" element={<Navigate to="/hr" replace />} />
      </Routes>
    </ActiveProductProvider>
  );
}
