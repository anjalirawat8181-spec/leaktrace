import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Exam, type User } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, EmptyState, Field, Icon, Input, Notice, PageHeader, Skeleton, StatusBadge, cx,
} from '../components/ui';
import { formatDateTime, formatDhms, useNow } from '../lib/hooks';

const TRACK = ['DRAFT', 'GENERATING', 'READY', 'SCHEDULED', 'RELEASED', 'CLOSED'] as const;

function ReleaseCountdown({ exam }: { exam: Exam }) {
  const now = useNow();
  const releaseAt = new Date(exam.startsAt).getTime() - exam.releaseLeadMin * 60000;
  const ms = releaseAt - now;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-fg-muted">{ms > 0 ? 'Release in' : 'Release window'}</span>
      <span className={cx('data-num text-sm', ms > 0 ? 'text-fg' : 'text-warn')}>{ms > 0 ? formatDhms(ms) : 'open or passed'}</span>
    </div>
  );
}

function StatusTrack({ status }: { status: Exam['status'] }) {
  const at = TRACK.indexOf(status);
  return (
    <ol className="flex gap-1" aria-label={`Progress: ${status}`}>
      {TRACK.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className="flex-1">
          <span className="sr-only">{s}{i === at ? ' (current)' : i < at ? ' (done)' : ''}</span>
          <span aria-hidden className={cx('block h-1.5 rounded-full transition-colors duration-base',
            i < at ? 'bg-ok/60' : i === at ? 'bg-ok' : 'bg-line')} />
        </li>
      ))}
    </ol>
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
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title">{(p) => <Input {...p} required value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Subject">{(p) => <Input {...p} required value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Starts at">{(p) => <Input {...p} type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
        <Field label="Duration (min)">{(p) => <Input {...p} type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}</Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" loading={create.isPending}>Create exam</Button>
          {create.error && <Notice tone="danger" className="flex-1">{(create.error as Error).message}</Notice>}
        </div>
      </form>
    </Card>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const [creating, setCreating] = useState(false);
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<Exam[]>('/exams') });

  return (
    <div>
      <PageHeader
        title="Exams"
        subtitle="Paper status, from draft to release."
        actions={user.role === 'CONTROLLER' && (
          <Button variant={creating ? 'secondary' : 'primary'} icon={creating ? 'close' : 'plus'} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New exam'}
          </Button>
        )}
      />
      {creating && <div className="mb-6"><NewExamForm onDone={() => setCreating(false)} /></div>}
      <QueryState query={exams} skeleton={
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading exams">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
        </div>
      }>
        {(list) => list.length === 0 ? (
          <EmptyState icon="exams" title="No exams yet">
            {user.role === 'CONTROLLER' ? 'Create the first exam to start writing a paper template.' : 'A controller has not created any exams.'}
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((exam) => (
              <li key={exam.id}>
                <Link to={`/exams/${exam.id}`}
                  className="block h-full rounded-lg border border-line bg-surface p-5 shadow-card transition-colors duration-fast hover:border-line-strong hover:bg-raised/50">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg leading-snug [overflow-wrap:anywhere]">{exam.title}</h2>
                      <p className="mt-0.5 text-sm text-fg-muted">{exam.subject}</p>
                    </div>
                    <Icon name="arrowleft" className="mt-1 shrink-0 rotate-180 text-fg-muted" />
                  </div>
                  <StatusTrack status={exam.status} />
                  <div className="mt-3 flex items-center justify-between">
                    <StatusBadge status={exam.status} />
                    <span className="text-xs text-fg-muted">{formatDateTime(exam.startsAt)}</span>
                  </div>
                  <div className="mt-3 border-t border-line pt-3"><ReleaseCountdown exam={exam} /></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
