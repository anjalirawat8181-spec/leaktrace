import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, type User } from '../api';
import {
  Badge, Card, CardHeader, ErrorState, Icon, LinkButton, Notice, PageHeader, Skeleton, Table, Td, Th, Tr, cx,
} from '../components/ui';
import { formatDateTime, useReducedMotion } from '../lib/hooks';

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

function tipText(e: Evidence) {
  return `${e.pointId} · ${e.kind.toLowerCase().replace('_', ' ')}: "${e.alternative}"${e.agrees ? ' · agrees with top copy' : ' · disagrees with top copy'}`;
}

function HighlightedLeak({ text, evidence, visible }: { text: string; evidence: Evidence[]; visible: number }) {
  const parts: React.ReactNode[] = [];
  const shown = [...evidence.slice(0, visible)].sort((a, b) => a.position.start - b.position.start);
  let cursor = 0;
  for (const e of shown) {
    if (e.position.start < cursor) continue;
    parts.push(text.slice(cursor, e.position.start));
    parts.push(
      <mark key={e.pointId} tabIndex={0} className="trace-mark" data-agrees={e.agrees} aria-label={`${text.slice(e.position.start, e.position.end)}. ${tipText(e)}`}>
        {text.slice(e.position.start, e.position.end)}
        <span className="tip" role="tooltip" aria-hidden>{tipText(e)}</span>
      </mark>,
    );
    cursor = e.position.end;
  }
  parts.push(text.slice(cursor));
  return <pre className="whitespace-pre-wrap font-mono text-sm leading-7">{parts}</pre>;
}

function Fact({ label, value, icon }: { label: string; value: React.ReactNode; icon: 'centres' | 'exams' | 'users' | 'target' }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-bg/60 p-4">
      <dt className="eyebrow flex items-center gap-2"><Icon name={icon} size={14} />{label}</dt>
      <dd className="mt-1 text-xl font-semibold [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Verdict({ result }: { result: TraceResult }) {
  const top = result.top;
  const odds = result.coincidence?.oneIn;
  if (result.status === 'IDENTIFIED' && top) {
    return (
      <Card tone="danger" className="shadow-glow-danger" aria-live="polite">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="danger" icon="target">LEAK TRACED</Badge>
          <span className="text-sm text-fg-muted">{top.matches} matches · {top.mismatches} mismatches</span>
        </div>
        <p className="mt-4 text-4xl font-semibold sm:text-5xl">Copy <span className="data-num text-danger">#{top.serial}</span></p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon="centres" label="Centre" value={<><span className="data-num">{top.centre.code}</span> <span className="text-base font-normal text-fg-muted">{top.centre.name}</span></>} />
          <Fact icon="exams" label="Room" value={top.room} />
          <Fact icon="target" label="Seat" value={<span className="data-num">{top.seat}</span>} />
          <Fact icon="users" label="Invigilator" value={top.invigilator} />
        </dl>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="eyebrow">Room bundle downloaded by</p>
            <p className="mt-1 text-sm">
              {top.downloadedBy.length
                ? top.downloadedBy.map((d) => `${d.by} at ${formatDateTime(d.at)}`).join('; ')
                : 'no recorded download'}
            </p>
          </div>
          <p className="data-num text-lg text-danger sm:text-2xl">
            chance of coincidence: {odds ? `1 in ${Math.round(odds).toLocaleString('en-US')}` : 'negligible'}
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card tone="warn" aria-live="polite">
      <Badge tone="warn" icon={result.status === 'POSSIBLE' ? 'question' : 'minus'}>{result.status}</Badge>
      <p className="mt-3 text-lg">
        {result.status === 'INSUFFICIENT'
          ? 'Too few variation points were visible in this excerpt to name a copy. Paste more lines, ideally several questions.'
          : 'The excerpt narrows the leak to a few candidates but not to a single copy.'}
      </p>
      {result.status === 'POSSIBLE' && result.candidates && (
        <div className="mt-4">
          <Table caption="Candidate copies">
            <thead><tr><Th>Copy</Th><Th>Centre</Th><Th>Room</Th><Th>Seat</Th><Th>m / x</Th><Th>Score</Th></tr></thead>
            <tbody>
              {result.candidates.map((c) => (
                <Tr key={c.serial}>
                  <Td className="data-num">#{c.serial}</Td><Td>{c.centre.code}</Td><Td>{c.room}</Td><Td className="data-num">{c.seat}</Td>
                  <Td className="data-num">{c.matches} / {c.mismatches}</Td><Td className="data-num">{c.score}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function TraceCasePage({ user }: { user: User }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
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
        if (reduced) setLit(r.evidence?.length ?? 0); else setAnimating(true);
        setParams({}, { replace: true });
        qc.invalidateQueries({ queryKey: ['trace-cases'] });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [runRequested, id, qc, setParams, reduced]);

  useEffect(() => {
    if (!stored.data || result) return;
    setResult(stored.data);
    setLit(stored.data.evidence?.length ?? 0);
  }, [stored.data, result]);

  const evidence = useMemo(() => [...(result?.evidence ?? [])].sort((a, b) => a.pointIndex - b.pointIndex), [result]);

  useEffect(() => {
    if (!animating) return;
    if (lit >= evidence.length) { setAnimating(false); return; }
    const t = setTimeout(() => setLit((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [animating, lit, evidence.length]);

  const back = <LinkButton to="/trace" variant="ghost" icon="arrowleft" className="-ml-3">Trace Lab</LinkButton>;

  if (error) return <div><PageHeader back={back} title="Trace failed" /><ErrorState message={error} /></div>;
  if (stored.isError && !result) return <div><PageHeader back={back} title="Trace case" /><ErrorState message={(stored.error as Error).message} onRetry={() => stored.refetch()} /></div>;
  if (!result) {
    return (
      <div role="status" aria-label={runRequested ? 'Running trace' : 'Loading'}>
        <PageHeader back={back} title={runRequested ? 'Running trace…' : 'Loading case…'} />
        <Skeleton className="mb-4 h-32" /><Skeleton className="h-64" />
      </div>
    );
  }

  const done = !animating && lit >= evidence.length;
  const observed = new Map(evidence.map((e, i) => [e.pointIndex, i]));

  return (
    <div className="max-w-5xl">
      <PageHeader back={back} title={result.case.title} subtitle={result.totalCopies !== undefined && `Traced against ${result.totalCopies} issued copies`} />

      <div className="space-y-6">
        {done && result.status ? <Verdict result={result} /> : result.status && (
          <Card><p className="flex items-center gap-3 text-fg-muted" role="status"><span className="size-4 animate-spin rounded-full border-2 border-info border-t-transparent" aria-hidden />Matching variation points against every issued copy…</p></Card>
        )}

        {result.totalPoints !== undefined && (
          <Card>
            <CardHeader title="Variation points">
              <span className="data-num">{lit} / {evidence.length}</span> observed of <span className="data-num">{result.totalPoints}</span>. Amber agrees with the top copy, red disagrees.
            </CardHeader>
            <ul className="flex flex-wrap gap-1.5" aria-label="Variation point grid">
              {Array.from({ length: result.totalPoints }, (_, i) => {
                const order = observed.get(i);
                const on = order !== undefined && order < lit;
                const bad = on && !evidence[order!].agrees;
                return (
                  <li key={i} title={on ? tipText(evidence[order!]) : `P${i + 1} not observed`}
                    className={cx('data-num w-11 rounded-md border py-1 text-center text-xs transition-colors duration-base',
                      bad ? 'border-danger bg-danger/25 text-danger'
                        : on ? 'border-warn bg-warn/20 text-warn'
                          : 'border-line text-fg-muted')}>
                    <span className="sr-only">{on ? tipText(evidence[order!]) : `P${i + 1} not observed`}</span>
                    <span aria-hidden>P{i + 1}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Leaked text">
            {result.case.evidenceKey ? 'Photo evidence attached and hash-verified. ' : ''}Hover or focus a highlighted phrase to see which variation it matched.
          </CardHeader>
          {evidence.length === 0 && done && <Notice className="mb-4" tone="info">No variation points were detected in this text.</Notice>}
          <HighlightedLeak text={result.case.leakText} evidence={evidence} visible={lit} />
        </Card>
      </div>
    </div>
  );
}
