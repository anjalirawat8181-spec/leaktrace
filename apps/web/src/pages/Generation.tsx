import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, type ExamDetail } from '../api';
import { ExamProgress } from '../components/ExamProgress';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, CardHeader, Icon, LinkButton, Notice, PageHeader, ProgressBar, Skeleton, Stat, StatusBadge, buttonClass, useToast,
} from '../components/ui';

interface GenerationStatus {
  examStatus: string;
  mode: 'aws' | 'cloud' | 'local';
  job: { id: string; total: number; done: number; failed: number; status: string; lastError: string | null; startedAt: string } | null;
  queueDepth: number | null;
  deadLetterDepth: number;
  workers: { desired: number; inService: number };
  warnings: string[];
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
    onSuccess: () => { refresh(); toast.push('Started. The copies are being made.', 'info'); },
  });
  const retry = useMutation({
    mutationFn: () => api(`/exams/${id}/rerender`, { method: 'POST' }),
    onSuccess: () => { refresh(); toast.push('Trying again.', 'info'); },
  });

  const s = status.data;
  const job = s?.job ?? null;
  const done = job?.status === 'DONE';
  useEffect(() => {
    if (done) qc.invalidateQueries({ queryKey: ['exam', id] });
  }, [done, id, qc]);

  const t = exam.data?.template;
  const blocked = !t ? 'Save the paper first (step 1).' : !t.sufficient ? 'The paper needs more {{ }} choices before it can make unique copies.' : '';
  const error = (generate.error ?? retry.error) as Error | null;
  const workersOk = (s?.workers.inService ?? 0) > 0;
  const working = Boolean(job) && !done && job?.status !== 'FAILED';
  const failed = job?.status === 'FAILED';
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={<>Generate copies{exam.data ? ` · ${exam.data.title}` : ''}</>}
        subtitle="Makes one uniquely worded PDF for every seat. It usually takes a minute or two."
      />
      {exam.data && (
        <ExamProgress exam={{ id: exam.data.id, status: exam.data.status, hasTemplate: Boolean(exam.data.template) }} canAct showAction={false} />
      )}
      <QueryState query={status} skeleton={<Skeleton className="h-96" />}>
        {(st) => (
          <Card>
            <CardHeader
              title="Progress"
              action={
                <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-raised px-3 py-1 text-xs font-medium" role="status">
                  <span aria-hidden className={`size-2 rounded-full ${workersOk ? 'bg-ok animate-pulse-dot' : 'bg-warn'}`} />
                  {workersOk ? 'A worker is online' : 'No worker online'}
                </span>
              }
            >
              {exam.data && <span className="inline-flex items-center gap-2">Exam status <StatusBadge status={exam.data.status} /></span>}
            </CardHeader>

            <div className="mb-6">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-sm">
                  {!job ? 'Nothing generated yet' : done ? 'All copies are ready' : failed ? 'Stopped: some copies could not be made'
                    : workersOk ? 'A worker is making the copies' : 'Waiting for a worker to start'}
                </p>
                <p className="data-num text-2xl font-semibold">{pct}%</p>
              </div>
              <ProgressBar label="Copies made" value={pct} tone={failed ? 'danger' : done ? 'ok' : 'info'} />
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Copies done" value={job ? `${job.done} / ${job.total}` : '–'} tone={done ? 'ok' : undefined} />
              <Stat label="Waiting in queue" value={st.queueDepth ?? '–'} hint="rooms waiting" />
              <Stat label="Workers online" value={`${st.workers.inService} / ${st.workers.desired}`} tone={workersOk ? 'ok' : working ? 'warn' : undefined} />
              <Stat label="Failed rooms" value={st.deadLetterDepth} tone={st.deadLetterDepth ? 'danger' : undefined} hint="gave up after retries" />
            </dl>

            <div className="mt-5 space-y-3">
              {done && <Notice tone="ok" icon="check">All {job?.total} copies are ready. Next: schedule the release.</Notice>}
              {job?.lastError && (
                <Notice tone="danger" icon="alert">
                  <strong className="font-semibold">Last error from the worker:</strong>{' '}
                  <span className="data-num text-sm [overflow-wrap:anywhere]">{job.lastError}</span>
                  {!done && <span className="mt-1 block text-sm">It retries by itself a few times. If it keeps failing, click Try again after fixing the cause.</span>}
                </Notice>
              )}
              {working && !workersOk && (
                <Notice tone="warn" icon="clock">
                  {st.mode === 'aws'
                    ? 'No worker running yet. One starts automatically within about 3 to 5 minutes after you click Generate.'
                    : st.mode === 'cloud'
                      ? 'The worker is starting up. This usually takes a few seconds.'
                      : <>No worker is running on this computer. Start one with: <span className="data-num">npm run dev --workspace @leaktrace/worker</span></>}
                </Notice>
              )}
              {st.warnings.length > 0 && (
                <Notice tone="info" icon="alert">
                  Some checks could not run, but generation is not affected:
                  <ul className="mt-1 list-disc pl-5 text-sm">{st.warnings.map((w) => <li key={w} className="[overflow-wrap:anywhere]">{w}</li>)}</ul>
                </Notice>
              )}
              {blocked && !job && <Notice icon="alert">{blocked}</Notice>}
              {error && <Notice tone="danger">{error.message}</Notice>}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {st.examStatus === 'DRAFT' && !job && (
                <Button variant="primary" size="lg" icon="cog" disabled={Boolean(blocked)} loading={generate.isPending} onClick={() => generate.mutate()}>
                  Generate copies
                </Button>
              )}
              {working && <Button size="lg" icon="cog" disabled loading>Making copies…</Button>}
              {(failed || (job?.lastError && !done && st.examStatus === 'GENERATING')) && (
                <Button variant="primary" size="lg" icon="refresh" loading={retry.isPending} onClick={() => retry.mutate()}>Try again</Button>
              )}
              {done && exam.data && <LinkButton to={`/exams/${exam.data.id}/schedule`} variant="primary" size="lg" icon="clock">Schedule release</LinkButton>}
              {job && (
                <a className={buttonClass('ghost', 'md', done ? '' : 'pointer-events-none opacity-50')}
                  href={`/api/exams/${id}/demo-set`} aria-disabled={!done} tabIndex={done ? undefined : -1}>
                  <Icon name="download" />5 sample copies (zip)
                </a>
              )}
            </div>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
