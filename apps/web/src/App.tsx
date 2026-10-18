import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { api, type User } from './api';
import CentresPage from './pages/Centres';
import DashboardPage from './pages/Dashboard';
import EditorPage from './pages/Editor';
import LoginPage from './pages/Login';

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
        </nav>
        <div className="ml-auto flex items-center gap-3 font-mono text-xs text-lab-dim">
          <span>{user.name} · {user.role}</span>
          <button className="btn" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        <Routes>
          <Route path="/" element={<DashboardPage user={user} />} />
          <Route path="/exams/:id" element={<EditorPage user={user} />} />
          <Route path="/centres" element={user.role === 'CONTROLLER' ? <CentresPage /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
