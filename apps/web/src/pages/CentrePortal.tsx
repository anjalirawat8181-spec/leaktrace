import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';

interface CentreExam {
  id: string; title: string; subject: string; startsAt: string; status: string;
  windowState: 'BEFORE' | 'OPEN' | 'CLOSED'; opensAt: string; closesAt: string;
  rooms: Array<{ id: string; name: string }>;
}
interface CentreResponse { serverTime: string; exams: CentreExam[] }
interface Download { rooms: Array<{ room: string; url: string; expiresAt: string }> }

const pad = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

function ExamCard({ exam, skew }: { exam: CentreExam; skew: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const serverNow = now + skew; // server clock, not the laptop's
  const opens = new Date(exam.opensAt).getTime();
  const closes = new Date(exam.closesAt).getTime();
  const download = useMutation({ mutationFn: () => api<Download>(`/centre/exams/${exam.id}/download`, { method: 'POST', json: {} }) });

  const closed = exam.status === 'CLOSED' || serverNow > closes;
  const before = serverNow < opens;
  const canDownload = !closed && !before && exam.status === 'RELEASED';

  return (
    <div className="panel space-y-4">
      <div>
        <h3 className="font-semibold">{exam.title}</h3>
        <p className="font-mono text-xs text-lab-dim">{exam.subject} · starts {new Date(exam.startsAt).toLocaleString()}</p>
      </div>
      <div className="text-center py-4">
        {closed ? (
          <p className="font-mono text-2xl text-red-400">Download window closed</p>
        ) : before ? (
          <p className="font-mono text-3xl text-amber-400">Paper unlocks in {hms(opens - serverNow)}</p>
        ) : canDownload ? (
          <p className="font-mono text-3xl text-emerald-400">Paper available · closes in {hms(closes - serverNow)}</p>
        ) : (
          <p className="font-mono text-xl text-amber-400">Window open, waiting for release…</p>
        )}
      </div>
      <button className="btn btn-primary w-full py-3 text-base" disabled={!canDownload || download.isPending}
        onClick={() => download.mutate()}>
        {download.isPending ? 'Requesting…' : 'Download papers'}
      </button>
      {download.error && (
        <p className="font-mono text-sm text-red-400" role="alert">
          Denied: {(download.error as any).body?.reason ?? (download.error as Error).message}
        </p>
      )}
      {download.data && (
        <ul className="font-mono text-sm space-y-1">
          {download.data.rooms.map((r) => (
            <li key={r.room} className="flex justify-between">
              <span>{r.room}</span>
              <a className="text-emerald-400 underline" href={r.url} target="_blank" rel="noreferrer">
                open PDF (link expires {new Date(r.expiresAt).toLocaleTimeString()})
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CentrePortalPage() {
  const data = useQuery({
    queryKey: ['centre-exams'],
    queryFn: () => api<CentreResponse>('/centre/exams'),
    refetchInterval: 5000,
  });
  const skew = data.data ? new Date(data.data.serverTime).getTime() - Date.now() : 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="border border-amber-600 bg-amber-950/30 text-amber-300 font-mono text-sm px-4 py-2 rounded">
        Every download is recorded: your name, centre, IP address and time.
      </div>
      {data.isLoading && <p className="font-mono text-lab-dim">loading…</p>}
      {data.data?.exams.length === 0 && <p className="font-mono text-lab-dim">No scheduled exams for your centre.</p>}
      {data.data?.exams.map((exam) => <ExamCard key={exam.id} exam={exam} skew={skew} />)}
    </div>
  );
}
