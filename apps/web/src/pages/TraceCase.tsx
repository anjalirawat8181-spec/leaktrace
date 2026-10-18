import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type User } from '../api';

interface Candidate {
  serial: number; centre: { code: string; name: string }; room: string; seat: number; invigilator: string;
  matches: number; mismatches: number; score: number; downloadedBy: Array<{ by: string; at: string }>;
}
interface Evidence {
  pointId: string; pointIndex: number; kind: string; alternative: string;
  position: { start: number; end: number }; agrees: boolean;
}
interface TraceResult {
  case: { id: string; title: string; leakText: string; status: string; evidenceKey: string | null };
  status?: 'IDENTIFIED' | 'POSSIBLE' | 'INSUFFICIENT';
  top?: Candidate | null;
  candidates?: Candidate[];
  evidence?: Evidence[];
  totalPoints?: number;
  totalCopies?: number;
  coincidence?: { oneIn: number | null };
}

const STEP_MS = 70;

function HighlightedLeak({ text, evidence, visible }: { text: string; evidence: Evidence[]; visible: number }) {
  const parts: React.ReactNode[] = [];
  const shown = [...evidence.slice(0, visible)].sort((a, b) => a.position.start - b.position.start);
  let cursor = 0;
  for (const e of shown) {
    if (e.position.start < cursor) continue; // overlapping detections: keep the first
    parts.push(text.slice(cursor, e.position.start));
    parts.push(
      <mark key={e.pointId} title={`${e.pointId}: "${e.alternative}"${e.agrees ? '' : ' (disagrees with top copy)'}`}
        className={e.agrees ? 'diff-hit' : 'bg-red-500/30 text-red-200 rounded-sm'}>
        {text.slice(e.position.start, e.position.end)}
      </mark>,
    );
    cursor = e.position.end;
  }
  parts.push(text.slice(cursor));
  return <pre className="whitespace-pre-wrap font-mono text-sm">{parts}</pre>;
}

export default function TraceCasePage({ user }: { user: User }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const runRequested = params.get('run') === '1' && user.role === 'CONTROLLER';
  const started = useRef(false);

  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState('');
  const [lit, setLit] = useState(0);
  const [animating, setAnimating] = useState(false);

  const stored = useQuery({
    queryKey: ['trace-case', id],
    queryFn: () => api<TraceResult>(`/trace/cases/${id}`),
    enabled: !runRequested,
  });

  useEffect(() => {
    if (!runRequested || started.current) return;
    started.current = true;
    (async () => {
      try {
        const r = await api<TraceResult>(`/trace/cases/${id}/run`, { method: 'POST' });
        setResult(r);
        setAnimating(true);
        setParams({}, { replace: true });
        qc.invalidateQueries({ queryKey: ['trace-cases'] });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [runRequested, id, qc, setParams]);

  useEffect(() => {
    if (!stored.data || result) return;
    setResult(stored.data);
    setLit(stored.data.evidence?.length ?? 0); // reviewing an old case: no animation
  }, [stored.data, result]);

  const evidence = useMemo(() => [...(result?.evidence ?? [])].sort((a, b) => a.pointIndex - b.pointIndex), [result]);

  useEffect(() => {
    if (!animating) return;
    if (lit >= evidence.length) { setAnimating(false); return; }
    const t = setTimeout(() => setLit((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [animating, lit, evidence.length]);

  if (error) return <p className="font-mono text-red-400" role="alert">{error}</p>;
  if (!result) return <p className="font-mono text-lab-dim">{runRequested ? 'running trace…' : 'loading…'}</p>;

  const done = !animating && lit >= evidence.length;
  const observed = new Map(evidence.map((e, i) => [e.pointIndex, i]));
  const top = result.top;
  const odds = result.coincidence?.oneIn;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/trace" className="font-mono text-sm text-lab-dim hover:text-white">← Trace Lab</Link>
        <h2 className="font-mono text-lg">{result.case.title}</h2>
      </div>

      {result.totalPoints !== undefined && (
        <div className="panel">
          <p className="label">Variation points ({lit} / {evidence.length} observed of {result.totalPoints})</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: result.totalPoints }, (_, i) => {
              const order = observed.get(i);
              const on = order !== undefined && order < lit;
              const bad = on && !evidence[order!].agrees;
              return (
                <span key={i} title={on ? `${evidence[order!].pointId}: ${evidence[order!].alternative}` : `P${i + 1}`}
                  className={`font-mono text-[10px] w-9 text-center py-1 rounded border transition-colors duration-200 ${
                    bad ? 'bg-red-500/30 border-red-500 text-red-200'
                      : on ? 'bg-amber-400/25 border-amber-400 text-amber-200'
                        : 'border-lab-line text-lab-dim'}`}>
                  P{i + 1}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {done && result.status && (
        result.status === 'IDENTIFIED' && top ? (
          <div className="panel border-red-600 bg-red-950/30 space-y-3">
            <p className="font-mono text-xs text-red-400 tracking-widest">LEAK TRACED</p>
            <p className="text-2xl font-semibold">Copy #{top.serial} · Centre {top.centre.code} · {top.room} · Seat {top.seat}</p>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
              <div className="flex gap-2"><dt className="text-lab-dim">Centre</dt><dd>{top.centre.name}</dd></div>
              <div className="flex gap-2"><dt className="text-lab-dim">Invigilator</dt><dd>{top.invigilator}</dd></div>
              <div className="flex gap-2 sm:col-span-2"><dt className="text-lab-dim">Room bundle downloaded by</dt>
                <dd>{top.downloadedBy.length
                  ? top.downloadedBy.map((d) => `${d.by} at ${new Date(d.at).toLocaleString()}`).join('; ')
                  : 'no recorded download'}</dd></div>
              <div className="flex gap-2"><dt className="text-lab-dim">Matches / mismatches</dt><dd>{top.matches} / {top.mismatches}</dd></div>
            </dl>
            <p className="font-mono text-lg text-red-300">
              chance of coincidence: {odds ? `1 in ${Math.round(odds).toLocaleString('en-US')}` : 'negligible'}
            </p>
          </div>
        ) : (
          <div className="panel border-amber-600 bg-amber-950/20 space-y-3">
            <p className="font-mono text-xs text-amber-400 tracking-widest">{result.status}</p>
            <p className="text-sm">
              {result.status === 'INSUFFICIENT'
                ? 'Too few variation points were visible in this excerpt to name a copy. Paste more lines, ideally several questions.'
                : 'The excerpt narrows the leak to a few candidates but not to a single copy.'}
            </p>
            {result.status === 'POSSIBLE' && result.candidates && (
              <table className="w-full font-mono text-xs">
                <thead className="text-lab-dim text-left"><tr><th>Copy</th><th>Centre</th><th>Room</th><th>Seat</th><th>m / x</th><th>Score</th></tr></thead>
                <tbody>
                  {result.candidates.map((c) => (
                    <tr key={c.serial} className="border-t border-lab-line">
                      <td>#{c.serial}</td><td>{c.centre.code}</td><td>{c.room}</td><td>{c.seat}</td>
                      <td>{c.matches} / {c.mismatches}</td><td>{c.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      )}

      <div className="panel">
        <p className="label">Leaked text {result.case.evidenceKey && '· photo evidence attached and hash-verified'}</p>
        <HighlightedLeak text={result.case.leakText} evidence={evidence} visible={lit} />
      </div>
    </div>
  );
}
