import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, type ExamDetail } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, CardHeader, Notice, PageHeader, ProgressBar, Skeleton, Stat, StatusBadge, LinkButton, buttonClass, cx,
  Icon, useToast,
} from '../components/ui';

interface GenerationStatus {
  examStatus: string;
  job: { id: string; total: number; done: number; failed: number; status: string } | null;
  queueDepth: number;
  deadLetterDepth: number;
  workers: { desired: number; inService: number };
}

export default function GenerationPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamDetail>(`/exams/${id}`) });
  const status = useQuery({
    queryKey: ['generation', id],
    queryFn: () => api<GenerationStatus>(`/exams/${id}/generation`),
    refetchInterval: 2000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['generation', id] });
    qc.invalidateQueries({ queryKey: ['exam', id] });
  };
  const generate = useMutation({
    mutationFn: () => api(`/exams/${id}/generate`, { method: 'POST' }),
    onSuccess: () => { refresh(); toast.push('Generation queued', 'info'); },
  });
  const rerender = useMutation({
    mutationFn: () => api(`/exams/${id}/rerender`, { method: 'POST' }),
    onSuccess: () => { refresh(); toast.push('Re-render queued', 'info'); },
  });

  const s = status.data;
  const job = s?.job;
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const t = exam.data?.template;
  const blocked = !t ? 'Save a template first.' : !t.sufficient ? 'Template capacity is too low.' : '';
  const error = (generate.error ?? rerender.error) as Error | null;
  const workersOk = (s?.workers.inService ?? 0) > 0;
  const done = job?.status === 'DONE';

  useEffect(() => {
    if (done) qc.invalidateQueries({ queryKey: ['exam', id] });
  }, [done, id, qc]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={<LinkButton to={`/exams/${id}`} variant="ghost" icon="arrowleft" className="-ml-3">Back to editor</LinkButton>}
        title={<>Generation{exam.data ? ` · ${exam.data.title}` : ''}</>}
        subtitle={exam.data && <StatusBadge status={exam.data.status} />}
      />
      <QueryState query={status} skeleton={<Skeleton className="h-96" />}>
        {(st) => (
          <Card>
            <CardHeader title="Copy generation"
              action={
                <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-raised px-3 py-1 text-xs font-medium"
                  role="status">
                  <span aria-hidden className={cx('size-2 rounded-full', workersOk ? 'bg-ok animate-pulse-dot' : 'bg-warn')} />
                  {workersOk ? 'Worker online' : 'No worker online'}
                </span>
              }>
              One merged PDF per room, rendered by the worker from the stored fingerprint vectors.
            </CardHeader>

            <div className="mb-6">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="data-num text-sm">{job ? `${job.status} · ${job.done} / ${job.total} copies` : 'no job yet'}</p>
                <p className="data-num text-2xl font-semibold">{pct}%</p>
              </div>
              <ProgressBar label="Generation progress" value={pct} tone={job?.failed ? 'danger' : done ? 'ok' : 'info'} />
            </div>

            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat label="Queue depth" value={st.queueDepth} hint="messages waiting" />
              <Stat label="Workers online" value={`${st.workers.inService} / ${st.workers.desired}`} tone={workersOk ? 'ok' : 'warn'} hint="heartbeat in the last 30 s" />
              <Stat label="Dead letters" value={st.deadLetterDepth} tone={st.deadLetterDepth ? 'danger' : undefined} hint="failed after 3 tries" />
            </dl>

            {!workersOk && st.queueDepth > 0 && (
              <Notice className="mt-5">No worker is running. Start one with: <span className="data-num">npm run dev --workspace @leaktrace/worker</span></Notice>
            )}
            {blocked && <Notice className="mt-5">{blocked}</Notice>}
            {error && <Notice tone="danger" className="mt-5">{error.message}</Notice>}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="primary" icon="cog" disabled={!!blocked || st.examStatus !== 'DRAFT'} loading={generate.isPending}
                onClick={() => generate.mutate()}>Generate</Button>
              <Button icon="refresh" disabled={!job} loading={rerender.isPending} onClick={() => rerender.mutate()}>Re-render</Button>
              <a className={buttonClass('secondary', 'md', job ? '' : 'pointer-events-none opacity-50')}
                href={`/api/exams/${id}/demo-set`} aria-disabled={!job} tabIndex={job ? undefined : -1}>
                <Icon name="download" />Demo set (5 copies, zip)
              </a>
            </div>
            <p className="mt-4 text-xs text-fg-muted">
              Re-render rebuilds every PDF from the stored vectors; the output is byte-identical, which makes it a safe way to demo the worker.
            </p>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
