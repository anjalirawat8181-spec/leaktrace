import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Exam, type User } from '../api';

const TRACK = ['DRAFT', 'GENERATING', 'READY', 'SCHEDULED', 'RELEASED', 'CLOSED'] as const;

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span className="text-amber-400">window open or passed</span>;
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = Math.floor(s / 86400);
  return <span>{d > 0 ? `${d}d ` : ''}{pad(Math.floor((s % 86400) / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}</span>;
}

function StatusTrack({ status }: { status: Exam['status'] }) {
  const at = TRACK.indexOf(status);
  return (
    <div className="flex gap-1" aria-label={`status ${status}`}>
      {TRACK.map((s, i) => (
        <div key={s} title={s} className={`h-1.5 flex-1 rounded ${i <= at ? 'bg-emerald-500' : 'bg-lab-line'}`} />
      ))}
    </div>
  );
}

function NewExamForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(90);
  const create = useMutation({
    mutationFn: () => api('/exams', {
      method: 'POST',
      json: { title, subject, startsAt: new Date(startsAt).toISOString(), durationMin: duration },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exams'] }); onDone(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-4 items-end">
      <div><label className="label">Title</label><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div><label className="label">Subject</label><input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div><label className="label">Starts at</label><input className="input" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
      <div><label className="label">Duration (min)</label><input className="input" type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
      <div className="sm:col-span-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={create.isPending}>Create exam</button>
        {create.error && <span className="font-mono text-sm text-red-400">{(create.error as Error).message}</span>}
      </div>
    </form>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const [creating, setCreating] = useState(false);
  const exams = useQuery({
    queryKey: ['exams'],
    queryFn: () => api<Exam[]>('/exams'),
    enabled: user.role !== 'SUPERINTENDENT',
  });

  if (user.role === 'SUPERINTENDENT') {
    return <p className="font-mono text-lab-dim">The centre portal arrives in a later milestone.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <h2 className="font-mono text-lg">Exams</h2>
        {user.role === 'CONTROLLER' && (
          <button className="btn ml-auto" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New exam'}
          </button>
        )}
      </div>
      {creating && <NewExamForm onDone={() => setCreating(false)} />}
      {exams.isLoading && <p className="font-mono text-lab-dim">loading…</p>}
      {exams.data?.length === 0 && <p className="font-mono text-lab-dim">No exams yet.</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {exams.data?.map((exam) => (
          <Link key={exam.id} to={`/exams/${exam.id}`} className="panel block hover:border-emerald-600 space-y-3">
            <div>
              <h3 className="font-semibold">{exam.title}</h3>
              <p className="font-mono text-xs text-lab-dim">{exam.subject}</p>
            </div>
            <StatusTrack status={exam.status} />
            <div className="flex justify-between font-mono text-xs">
              <span className="text-lab-dim">{exam.status}</span>
              <span>release in <Countdown to={new Date(new Date(exam.startsAt).getTime() - exam.releaseLeadMin * 60000).toISOString()} /></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
