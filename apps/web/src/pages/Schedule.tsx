import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type ExamDetail } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, CardHeader, Field, Icon, Input, LinkButton, Notice, PageHeader, Skeleton, StatusBadge, useToast,
} from '../components/ui';
import { formatDateTime } from '../lib/hooks';

interface ScheduleInfo {
  status: string;
  timezone: string;
  release: { name: string; at: string; local: string };
  close: { name: string; at: string; local: string };
}

export default function SchedulePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamDetail>(`/exams/${id}`) });
  const info = useQuery({ queryKey: ['schedule', id], queryFn: () => api<ScheduleInfo>(`/exams/${id}/schedule`) });
  const [lead, setLead] = useState(15);
  const [closeAfter, setCloseAfter] = useState(30);

  useEffect(() => {
    if (exam.data) { setLead(exam.data.releaseLeadMin); setCloseAfter(exam.data.closeAfterMin); }
  }, [exam.data]);

  const schedule = useMutation({
    mutationFn: () => api<ScheduleInfo>(`/exams/${id}/schedule`, {
      method: 'POST', json: { releaseLeadMin: lead, closeAfterMin: closeAfter },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule', id] });
      qc.invalidateQueries({ queryKey: ['exam', id] });
      toast.push('Schedules saved');
    },
  });

  const status = info.data?.status ?? exam.data?.status;
  const canSchedule = status === 'READY' || status === 'SCHEDULED';
  const scheduled = ['SCHEDULED', 'RELEASED', 'CLOSED'].includes(status ?? '');

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={<LinkButton to={`/exams/${id}`} variant="ghost" icon="arrowleft" className="-ml-3">Back to editor</LinkButton>}
        title={<>Schedule{exam.data ? ` · ${exam.data.title}` : ''}</>}
        subtitle={status && <StatusBadge status={status} />}
      />
      <QueryState query={exam} skeleton={<Skeleton className="h-64" />}>
        {(e) => (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Release window">
                Exam starts {formatDateTime(e.startsAt)}. Times are scheduled in {info.data?.timezone ?? 'Asia/Kolkata'}.
              </CardHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Release lead (min before start)">
                  {(p) => <Input {...p} type="number" min={0} max={240} value={lead} disabled={!canSchedule} onChange={(ev) => setLead(Number(ev.target.value))} />}
                </Field>
                <Field label="Close after start (min)">
                  {(p) => <Input {...p} type="number" min={0} max={240} value={closeAfter} disabled={!canSchedule} onChange={(ev) => setCloseAfter(Number(ev.target.value))} />}
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button variant="primary" icon="clock" disabled={!canSchedule} loading={schedule.isPending} onClick={() => schedule.mutate()}>
                  {status === 'SCHEDULED' ? 'Reschedule' : 'Create schedules'}
                </Button>
              </div>
              {!canSchedule && !scheduled && <Notice className="mt-4">Generate the copies first: the exam must be READY.</Notice>}
              {schedule.error && <Notice tone="danger" className="mt-4">{(schedule.error as Error).message}</Notice>}
            </Card>

            {scheduled && info.data && (
              <div className="grid gap-4 sm:grid-cols-2">
                {([['Release', 'unlock', info.data.release], ['Close', 'lock', info.data.close]] as const).map(([label, icon, s]) => (
                  <Card key={label}>
                    <p className="eyebrow flex items-center gap-2"><Icon name={icon} size={16} />{label}</p>
                    <p className="data-num mt-2 text-sm [overflow-wrap:anywhere]">{s.name}</p>
                    <p className="data-num mt-1 text-lg">{s.local.replace('T', ' ')}</p>
                    <p className="text-xs text-fg-muted">{info.data.timezone}</p>
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
