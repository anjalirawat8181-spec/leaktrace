import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Exam, type User } from '../api';

interface CaseRow {
  id: string; title: string; examTitle: string; status: 'OPEN' | 'IDENTIFIED' | 'INCONCLUSIVE'; createdAt: string;
}

const STATUS_STYLE = {
  OPEN: 'text-lab-dim',
  IDENTIFIED: 'text-red-400',
  INCONCLUSIVE: 'text-amber-400',
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function TraceLabPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const canRun = user.role === 'CONTROLLER';
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<Exam[]>('/exams'), enabled: canRun });
  const cases = useQuery({ queryKey: ['trace-cases'], queryFn: () => api<CaseRow[]>('/trace/cases') });

  const [examId, setExamId] = useState('');
  const [title, setTitle] = useState('');
  const [leakText, setLeakText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api<{ id: string }>('/trace/cases', {
        method: 'POST', json: { examId: examId || exams.data?.[0]?.id, title, leakText },
      });
      if (photo) {
        const sha256 = await sha256Hex(photo); // hashed in the browser; the server re-checks it
        const { url } = await api<{ url: string }>(`/trace/cases/${created.id}/evidence-url`, {
          method: 'POST', json: { sha256, contentType: photo.type },
        });
        const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': photo.type }, body: photo });
        if (!put.ok) throw new Error('Evidence upload failed');
      }
      navigate(`/trace/${created.id}?run=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="font-mono text-lg">Trace Lab</h2>

      {canRun ? (
        <form onSubmit={submit} className="panel space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Exam</label>
              <select className="input" value={examId} onChange={(e) => setExamId(e.target.value)}>
                {exams.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select></div>
            <div><label className="label">Case title</label>
              <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Telegram screenshot" /></div>
          </div>
          <div><label className="label">Leaked text (paste a few lines)</label>
            <textarea className="input h-48 font-mono" required value={leakText} onChange={(e) => setLeakText(e.target.value)} /></div>
          <div><label className="label">Photo evidence (optional)</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="font-mono text-xs"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></div>
          {error && <p className="font-mono text-sm text-red-400" role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={busy || !leakText.trim() || !title.trim()}>
            {busy ? 'Preparing…' : 'Run trace'}
          </button>
        </form>
      ) : (
        <p className="font-mono text-xs text-lab-dim">Read-only access: open a case below to review its result.</p>
      )}

      <div className="panel p-0 overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="text-lab-dim text-xs text-left"><tr><th className="p-2">Case</th><th>Exam</th><th>Status</th><th>Opened</th></tr></thead>
          <tbody>
            {cases.data?.map((c) => (
              <tr key={c.id} className="border-t border-lab-line">
                <td className="p-2"><Link className="text-emerald-400 hover:underline" to={`/trace/${c.id}`}>{c.title}</Link></td>
                <td>{c.examTitle}</td>
                <td className={STATUS_STYLE[c.status]}>{c.status}</td>
                <td className="text-lab-dim">{new Date(c.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {cases.data?.length === 0 && <tr><td className="p-3 text-lab-dim" colSpan={4}>No cases yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
