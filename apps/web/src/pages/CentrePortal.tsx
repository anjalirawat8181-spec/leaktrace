import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Badge, Button, Card, EmptyState, Icon, Notice, PageHeader, Skeleton, cx,
} from '../components/ui';
import { formatHms, formatIst, useNow } from '../lib/hooks';

interface CentreExam {
  id: string; title: string; subject: string; startsAt: string; status: string;
  windowState: 'BEFORE' | 'OPEN' | 'CLOSED'; state: 'LOCKED' | 'OPEN' | 'CLOSED'; releasePending: boolean;
  opensAt: string; closesAt: string;
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

  const closed = exam.state === 'CLOSED' || serverNow > closes;
  const canDownload = !closed && exam.state === 'OPEN' && serverNow >= opens;
  const locked = !closed && !canDownload;

  const tone = closed ? 'danger' : canDownload ? 'ok' : 'warn';
  const color = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[tone];
  const big = closed ? 'Closed' : canDownload ? 'Download now' : `Locked until ${formatIst(exam.opensAt)}`;
  const small = closed
    ? `Downloads stopped at ${formatIst(exam.closesAt)}.`
    : canDownload
      ? `Downloads stop at ${formatIst(exam.closesAt)} (in ${formatHms(closes - serverNow)}).`
      : exam.releasePending || serverNow >= opens
        ? 'Opening now… this page updates by itself.'
        : `Paper unlocks in ${formatHms(opens - serverNow)}`;

  return (
    <Card tone={canDownload ? 'ok' : closed ? 'danger' : 'default'}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl [overflow-wrap:anywhere]">{exam.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{exam.subject} · exam starts {formatIst(exam.startsAt)}</p>
        </div>
        <Badge tone={tone} icon={closed ? 'lock' : canDownload ? 'unlock' : 'clock'}>{closed ? 'CLOSED' : canDownload ? 'OPEN' : 'LOCKED'}</Badge>
      </div>

      <div className="my-8 text-center" role="timer" aria-live="off" aria-label={`${big}. ${small}`}>
        <p className={cx('flex items-center justify-center gap-3 text-2xl font-bold sm:text-4xl', color)}>
          <Icon name={closed ? 'lock' : canDownload ? 'unlock' : 'clock'} size={36} />{big}
        </p>
        <p className="data-num mt-3 text-base text-fg-muted sm:text-lg">{small}</p>
      </div>

      <Button variant="primary" size="lg" className="w-full" icon="download" disabled={!canDownload} loading={download.isPending}
        onClick={() => download.mutate()}>
        {download.isPending ? 'Requesting…' : 'Download papers'}
      </Button>
      {locked && <p className="mt-2 text-center text-xs text-fg-muted">The button unlocks by itself when the time comes.</p>}

      {download.error && (
        <Notice tone="danger" className="mt-4">
          {(download.error as any).body?.reason ? `Download blocked: ${(download.error as any).body.reason}` : (download.error as Error).message}
        </Notice>
      )}
      {download.data && (
        <ul className="mt-5 divide-y divide-line rounded-lg border border-line">
          {download.data.rooms.map((r) => (
            <li key={r.room} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="font-medium">{r.room}</span>
              <a className="inline-flex min-h-11 items-center gap-2 text-info underline underline-offset-4" href={r.url} target="_blank" rel="noreferrer">
                <Icon name="download" size={16} />open PDF (link works for 2 minutes)
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
      <PageHeader title="Download papers" subtitle="Your centre's exam papers. You can only download while the window is open." />
      <Notice tone="warn" icon="eye" className="mb-6">
        <strong className="font-semibold">Every download is recorded:</strong> your name, centre, IP address and time.
      </Notice>
      <QueryState query={data} skeleton={<Skeleton className="h-80" />}>
        {(res) => res.exams.length === 0 ? (
          <EmptyState icon="clock" title="No exams for your centre right now">
            Exams appear here once they are scheduled, and stay for 24 hours after they close.
          </EmptyState>
        ) : (
          <div className="space-y-6">{res.exams.map((exam) => <ExamCard key={exam.id} exam={exam} skew={skew} />)}</div>
        )}
      </QueryState>
    </div>
  );
}
