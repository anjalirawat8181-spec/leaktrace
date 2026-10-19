import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, type User } from './api';
import { AppShell } from './components/AppShell';
import { Skeleton } from './components/ui';
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

  if (me.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center p-6" role="status" aria-label="Loading">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  const user = me.data;
  if (!user) return <LoginPage />;

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.setQueryData(['me'], null);
    qc.clear();
  };

  const notSuper = user.role !== 'SUPERINTENDENT';
  const controller = user.role === 'CONTROLLER';

  return (
    <AppShell user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={user.role === 'SUPERINTENDENT' ? <CentrePortalPage /> : <DashboardPage user={user} />} />
        <Route path="/exams/:id" element={<EditorPage user={user} />} />
        <Route path="/exams/:id/generation" element={controller ? <GenerationPage /> : <Navigate to="/" />} />
        <Route path="/exams/:id/schedule" element={controller ? <SchedulePage /> : <Navigate to="/" />} />
        <Route path="/trace" element={notSuper ? <TraceLabPage user={user} /> : <Navigate to="/" />} />
        <Route path="/trace/:id" element={notSuper ? <TraceCasePage user={user} /> : <Navigate to="/" />} />
        <Route path="/audit" element={notSuper ? <AuditPage /> : <Navigate to="/" />} />
        <Route path="/outbox" element={notSuper ? <OutboxPage /> : <Navigate to="/" />} />
        <Route path="/centres" element={controller ? <CentresPage /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AppShell>
  );
}
