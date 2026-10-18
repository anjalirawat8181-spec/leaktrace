import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { api, type User } from './api';
import AuditPage from './pages/Audit';
import CentrePortalPage from './pages/CentrePortal';
import CentresPage from './pages/Centres';
import DashboardPage from './pages/Dashboard';
import GenerationPage from './pages/Generation';
import EditorPage from './pages/Editor';
import LoginPage from './pages/Login';
import OutboxPage from './pages/Outbox';
import TraceCasePage from './pages/TraceCase';
import TraceLabPage from './pages/TraceLab';
import SchedulePage from './pages/Schedule';

export default function App() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<User>('/auth/me').catch(() => null),
  });

  if (me.isLoading) return <p className="p-6 font-mono text-lab-dim">booting lab…</p>;
  const user = me.data;
  if (!user) return <LoginPage />;

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.setQueryData(['me'], null);
    qc.clear();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-lab-line px-6 py-3 flex items-center gap-6">
        <Link to="/" className="font-mono font-bold text-emerald-400 tracking-widest">LEAKTRACE</Link>
        <nav className="flex gap-4 font-mono text-sm text-lab-dim">
          <Link to="/" className="hover:text-white">Exams</Link>
          {user.role === 'CONTROLLER' && <Link to="/centres" className="hover:text-white">Centres</Link>}
          {user.role !== 'SUPERINTENDENT' && <Link to="/trace" className="hover:text-white">Trace Lab</Link>}
          {user.role !== 'SUPERINTENDENT' && <Link to="/audit" className="hover:text-white">Audit</Link>}
          {user.role !== 'SUPERINTENDENT' && <Link to="/outbox" className="hover:text-white">Outbox</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 font-mono text-xs text-lab-dim">
          <span>{user.name} · {user.role}</span>
          <button className="btn" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        <Routes>
          <Route path="/" element={user.role === 'SUPERINTENDENT' ? <CentrePortalPage /> : <DashboardPage user={user} />} />
          <Route path="/exams/:id" element={<EditorPage user={user} />} />
          <Route path="/exams/:id/generation" element={user.role === 'CONTROLLER' ? <GenerationPage /> : <Navigate to="/" />} />
          <Route path="/exams/:id/schedule" element={user.role === 'CONTROLLER' ? <SchedulePage /> : <Navigate to="/" />} />
          <Route path="/trace" element={user.role !== 'SUPERINTENDENT' ? <TraceLabPage user={user} /> : <Navigate to="/" />} />
          <Route path="/trace/:id" element={user.role !== 'SUPERINTENDENT' ? <TraceCasePage user={user} /> : <Navigate to="/" />} />
          <Route path="/audit" element={user.role !== 'SUPERINTENDENT' ? <AuditPage /> : <Navigate to="/" />} />
          <Route path="/outbox" element={user.role !== 'SUPERINTENDENT' ? <OutboxPage /> : <Navigate to="/" />} />
          <Route path="/centres" element={user.role === 'CONTROLLER' ? <CentresPage /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
