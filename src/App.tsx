import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import CommandPage from './pages/CommandPage';
import ReportPage from './pages/ReportPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/report" element={<ReportPage />} />
        <Route path="/command" element={<CommandPage />} />
        <Route path="*" element={<Navigate to="/report" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
