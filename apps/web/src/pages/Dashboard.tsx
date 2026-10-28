import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Exam, type User } from '../api';
import { DeleteExamDialog } from '../components/DeleteExamDialog';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, EmptyState, Field, Input, Notice, PageHeader, Skeleton, StatusBadge, cx,
} from '../components/ui';
import { formatDateTime, formatDhms, useNow } from '../lib/hooks';
import { STEPS, currentStep } from '../lib/steps';

function MiniSteps({ exam }: { exam: Exam }) {
  const at = currentStep(exam);
  return (
    <div>
      <ol className="flex gap-1" aria-label={`Step ${at + 1} of ${STEPS.length}: ${STEPS[at].label}`}>
        {STEPS.map((s, i) => (
          <li key={s.key} aria-hidden className={cx('h-1.5 flex-1 rounded-full transition-colors duration-base', i < at ? 'bg-ok/60' : i === at ? 'bg-ok' : 'bg-line')} />
        ))}
      </ol>
      <p className="mt-2 text-xs text-fg-muted">Step {at + 1} of {STEPS.length}: <span className="font-medium text-fg">{STEPS[at].label}</span></p>
    </div>
  );
}

function WhenLine({ exam }: { exam: Exam }) {
  const now = useNow();
  if (exam.status === 'SCHEDULED' && exam.releaseAt) {
    const ms = new Date(exam.releaseAt).getTime() - now;
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-fg-muted">{ms > 0 ? 'Releases in' : 'Releasing now'}</span>
        <span className="data-num text-sm">{ms > 0 ? formatDhms(ms) : '…'}</span>
      </div>
    );
  }
  if (exam.status === 'RELEASED') return <p className="text-xs text-ok">Centres can download now</p>;
  if (exam.status === 'CLOSED') return <p className="text-xs text-fg-muted">Downloads are closed</p>;
  return <p className="text-xs text-fg-muted">Exam starts {formatDateTime(exam.startsAt)}</p>;
}

function NewExamForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(90);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/exams', {
      method: 'POST',
      json: { title, subject, startsAt: new Date(`${startsAt}:00+05:30`).toISOString(), durationMin: duration },
    }),
    onSuccess: (exam) => { qc.invalidateQueries({ queryKey: ['exams'] }); onDone(); navigate(`/exams/${exam.id}`); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Exam title">{(p) => <Input {...p} required value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Subject">{(p) => <Input {...p} required value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Exam starts (India time)">{(p) => <Input {...p} type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
        <Field label="Length (minutes)">{(p) => <Input {...p} type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}</Field>
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
  const [deleting, setDeleting] = useState<Exam | null>(null);
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<Exam[]>('/exams'), refetchInterval: 10_000 });
  const controller = user.role === 'CONTROLLER';

  return (
    <div>
      <PageHeader
        title="Exams"
        subtitle="Create an exam, prepare its paper, and follow it step by step until it closes."
        actions={controller && (
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
            {controller ? 'Create the first exam to start writing a paper.' : 'A controller has not created any exams yet.'}
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((exam) => (
              <li key={exam.id} className="relative">
                <Link to={`/exams/${exam.id}`}
                  className={cx('block h-full rounded-lg border border-line bg-surface p-5 shadow-card transition-colors duration-fast hover:border-line-strong hover:bg-raised/50', controller && 'pb-16')}>
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg leading-snug [overflow-wrap:anywhere]">{exam.title}</h2>
                      <p className="mt-0.5 text-sm text-fg-muted">{exam.subject}</p>
                    </div>
                    <StatusBadge status={exam.status} />
                  </div>
                  <MiniSteps exam={exam} />
                  <div className="mt-3 border-t border-line pt-3"><WhenLine exam={exam} /></div>
                </Link>
                {controller && (
                  <Button variant="ghost" icon="trash" className="absolute bottom-3 right-3 text-danger hover:text-danger"
                    aria-label={`Delete exam ${exam.title}`} onClick={() => setDeleting(exam)}>Delete</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {deleting && <DeleteExamDialog exam={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />}
    </div>
  );
}
