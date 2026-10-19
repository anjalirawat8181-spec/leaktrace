import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Badge, Button, Card, EmptyState, Icon, Notice, PageHeader, Skeleton, cx,
} from '../components/ui';
import { formatDateTime, formatHms, useNow } from '../lib/hooks';

interface CentreExam {
  id: string; title: string; subject: string; startsAt: string; status: string;
  windowState: 'BEFORE' | 'OPEN' | 'CLOSED'; opensAt: string; closesAt: string;
  rooms: Array<{ id: string; name: string }>;
}
interface CentreResponse { serverTime: string; exams: CentreExam[] }
interface Download { rooms: Array<{ room: string; url: string; expiresAt: string }> }

function ExamCard({ exam, skew }: { exam: CentreExam; skew: number }) {
  const now = useNow();
  const serverNow = now + skew;
  const opens = new Date(exam.opensAt).getTime();
  const closes = new Date(exam.closesAt).getTime();
  const download = useMutation({ mutationFn: () => api<Download>(`/centre/exams/${exam.id}/download`, { method: 'POST', json: {} }) });

  const closed = exam.status === 'CLOSED' || serverNow > closes;
  const before = serverNow < opens;
  const canDownload = !closed && !before && exam.status === 'RELEASED';

  const state = closed
    ? { tone: 'danger' as const, icon: 'lock' as const, label: 'Download window closed', digits: null }
    : before
      ? { tone: 'warn' as const, icon: 'clock' as const, label: 'Paper unlocks in', digits: formatHms(opens - serverNow) }
      : canDownload
        ? { tone: 'ok' as const, icon: 'unlock' as const, label: 'Paper available · closes in', digits: formatHms(closes - serverNow) }
        : { tone: 'warn' as const, icon: 'clock' as const, label: 'Window open, waiting for release…', digits: null };
  const color = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[state.tone];

  return (
    <Card tone={canDownload ? 'ok' : closed ? 'danger' : 'default'}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl [overflow-wrap:anywhere]">{exam.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{exam.subject} · starts {formatDateTime(exam.startsAt)}</p>
        </div>
        <Badge tone={state.tone} icon={state.icon}>{canDownload ? 'OPEN' : closed ? 'CLOSED' : 'LOCKED'}</Badge>
      </div>

      <div className="my-8 text-center" role="timer" aria-live="off" aria-label={`${state.label} ${state.digits ?? ''}`}>
        <p className={cx('flex items-center justify-center gap-2 text-base font-medium sm:text-lg', color)}>
          <Icon name={state.icon} size={20} />{state.label}
        </p>
        {state.digits && <p className={cx('data-num mt-2 text-5xl font-semibold sm:text-7xl', color)}>{state.digits}</p>}
      </div>

      <Button variant="primary" size="lg" className="w-full" icon="download" disabled={!canDownload} loading={download.isPending}
        onClick={() => download.mutate()}>
        {download.isPending ? 'Requesting…' : 'Download papers'}
      </Button>
      {!canDownload && !closed && <p className="mt-2 text-center text-xs text-fg-muted">The button unlocks automatically when the window opens.</p>}

      {download.error && (
        <Notice tone="danger" className="mt-4">
          Denied: {(download.error as any).body?.reason ?? (download.error as Error).message}
        </Notice>
      )}
      {download.data && (
        <ul className="mt-5 divide-y divide-line rounded-lg border border-line">
          {download.data.rooms.map((r) => (
            <li key={r.room} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="font-medium">{r.room}</span>
              <a className="inline-flex min-h-11 items-center gap-2 text-info underline underline-offset-4" href={r.url} target="_blank" rel="noreferrer">
                <Icon name="download" size={16} />open PDF (link expires {new Date(r.expiresAt).toLocaleTimeString()})
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Centre portal" subtitle="Download your centre's exam papers inside the release window." />
      <Notice tone="warn" icon="eye" className="mb-6">
        <strong className="font-semibold">Every download is recorded:</strong> your name, centre, IP address and time.
      </Notice>
      <QueryState query={data} skeleton={<Skeleton className="h-80" />}>
        {(res) => res.exams.length === 0 ? (
          <EmptyState icon="clock" title="No scheduled exams">No scheduled exams for your centre.</EmptyState>
        ) : (
          <div className="space-y-6">{res.exams.map((exam) => <ExamCard key={exam.id} exam={exam} skew={skew} />)}</div>
        )}
      </QueryState>
    </div>
  );
}
