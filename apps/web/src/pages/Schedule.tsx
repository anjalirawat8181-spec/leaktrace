import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type ExamDetail } from '../api';
import { ExamProgress } from '../components/ExamProgress';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, CardHeader, Field, Icon, Input, Notice, PageHeader, Skeleton, StatusBadge, useToast,
} from '../components/ui';
import { formatIst } from '../lib/hooks';

interface ScheduleInfo {
  status: string;
  timezone: string;
  startsAt: string;
  suggested: { releaseAt: string; closeAt: string };
  release: { name: string; at: string; local: string };
  close: { name: string; at: string; local: string };
}

function istNowPlus(minutes: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(Date.now() + minutes * 60_000));
  const p = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}

export function validateTimes(releaseAt: string, closeAt: string): { release?: string; close?: string } {
  const errors: { release?: string; close?: string } = {};
  if (!releaseAt) errors.release = 'Pick when the papers should unlock.';
  else if (releaseAt < istNowPlus(1)) errors.release = 'Release time must be at least 1 minute from now (India time).';
  if (!closeAt) errors.close = 'Pick when downloads should stop.';
  else if (releaseAt && closeAt <= releaseAt) errors.close = 'Close time must be after the release time.';
  return errors;
}

export default function SchedulePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamDetail>(`/exams/${id}`) });
  const info = useQuery({ queryKey: ['schedule', id], queryFn: () => api<ScheduleInfo>(`/exams/${id}/schedule`) });
  const [releaseAt, setReleaseAt] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [touched, setTouched] = useState(false);

  const scheduled = ['SCHEDULED', 'RELEASED', 'CLOSED'].includes(info.data?.status ?? exam.data?.status ?? '');
  useEffect(() => {
    const d = info.data;
    if (!d) return;
    if (scheduled) { setReleaseAt(d.release.local.slice(0, 16)); setCloseAt(d.close.local.slice(0, 16)); }
    else { setReleaseAt(d.suggested.releaseAt); setCloseAt(d.suggested.closeAt); }
  }, [info.data, scheduled]);

  const schedule = useMutation({
    mutationFn: () => api<ScheduleInfo>(`/exams/${id}/schedule`, { method: 'POST', json: { releaseAt, closeAt } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule', id] });
      qc.invalidateQueries({ queryKey: ['exam', id] });
      qc.invalidateQueries({ queryKey: ['exams'] });
      toast.push('Schedule saved. Papers unlock and lock by themselves.');
    },
  });

  const status = info.data?.status ?? exam.data?.status;
  const canSchedule = status === 'READY' || status === 'SCHEDULED';
  const errors = validateTimes(releaseAt, closeAt);
  const hasErrors = Boolean(errors.release || errors.close);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={<>Schedule release{exam.data ? ` · ${exam.data.title}` : ''}</>}
        subtitle="Choose when centres can download the papers, and when downloads stop. All times are India time."
      />
      {exam.data && (
        <ExamProgress exam={{ id: exam.data.id, status: exam.data.status, hasTemplate: Boolean(exam.data.template) }} canAct showAction={false} />
      )}
      <QueryState query={exam} skeleton={<Skeleton className="h-64" />}>
        {(e) => (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Download window" action={status && <StatusBadge status={status} />}>
                The exam starts {formatIst(e.startsAt)} (India time).
              </CardHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Release at (India time)" hint="Papers unlock for superintendents at this time." error={touched ? errors.release : undefined}>
                  {(p) => <Input {...p} type="datetime-local" value={releaseAt} disabled={!canSchedule} onChange={(ev) => setReleaseAt(ev.target.value)} />}
                </Field>
                <Field label="Close at (India time)" hint="Downloads stop at this time." error={touched ? errors.close : undefined}>
                  {(p) => <Input {...p} type="datetime-local" value={closeAt} disabled={!canSchedule} onChange={(ev) => setCloseAt(ev.target.value)} />}
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button variant="primary" size="lg" icon="clock" disabled={!canSchedule} loading={schedule.isPending}
                  onClick={() => { setTouched(true); if (!hasErrors) schedule.mutate(); }}>
                  {status === 'SCHEDULED' ? 'Save new times' : 'Schedule release'}
                </Button>
              </div>
              {!canSchedule && status && !scheduled && <Notice className="mt-4">Generate the copies first. The exam must be Ready before it can be scheduled.</Notice>}
              {scheduled && status !== 'SCHEDULED' && <Notice className="mt-4" tone="info">This exam is already {status === 'RELEASED' ? 'released' : 'closed'}, so the times can no longer change.</Notice>}
              {schedule.error && <Notice tone="danger" className="mt-4">{(schedule.error as Error).message}</Notice>}
            </Card>

            {scheduled && info.data && (
              <div className="grid gap-4 sm:grid-cols-2">
                {([['Papers unlock', 'unlock', info.data.release], ['Downloads stop', 'lock', info.data.close]] as const).map(([label, icon, s]) => (
                  <Card key={label}>
                    <p className="eyebrow flex items-center gap-2"><Icon name={icon} size={16} />{label}</p>
                    <p className="data-num mt-2 text-xl">{s.local.replace('T', ' ').slice(0, 16)}</p>
                    <p className="text-xs text-fg-muted">India time</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
