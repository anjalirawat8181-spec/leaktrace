import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type ExamDetail } from '../api';

interface ScheduleInfo {
  status: string;
  timezone: string;
  release: { name: string; at: string; local: string };
  close: { name: string; at: string; local: string };
}

export default function SchedulePage() {
  const { id } = useParams();
  const qc = useQueryClient();
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
    },
  });

  const status = info.data?.status ?? exam.data?.status;
  const canSchedule = status === 'READY' || status === 'SCHEDULED';
  const scheduled = ['SCHEDULED', 'RELEASED', 'CLOSED'].includes(status ?? '');

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link to={`/exams/${id}`} className="font-mono text-sm text-lab-dim hover:text-white">← editor</Link>
        <h2 className="font-mono text-lg">Schedule · {exam.data?.title}</h2>
        <span className="ml-auto font-mono text-xs text-lab-dim">{status}</span>
      </div>

      <div className="panel space-y-4">
        <p className="font-mono text-xs text-lab-dim">
          Exam starts {exam.data && new Date(exam.data.startsAt).toLocaleString()}. Times are scheduled in {info.data?.timezone ?? 'Asia/Kolkata'}.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Release lead (min before start)</label>
            <input className="input" type="number" min={0} max={240} value={lead} disabled={!canSchedule}
              onChange={(e) => setLead(Number(e.target.value))} /></div>
          <div><label className="label">Close after start (min)</label>
            <input className="input" type="number" min={0} max={240} value={closeAfter} disabled={!canSchedule}
              onChange={(e) => setCloseAfter(Number(e.target.value))} /></div>
        </div>
        <button className="btn btn-primary" disabled={!canSchedule || schedule.isPending} onClick={() => schedule.mutate()}>
          {status === 'SCHEDULED' ? 'Reschedule' : 'Create schedules'}
        </button>
        {!canSchedule && !scheduled && (
          <p className="font-mono text-xs text-amber-400">Generate the copies first: the exam must be READY.</p>
        )}
        {schedule.error && <p className="font-mono text-sm text-red-400" role="alert">{(schedule.error as Error).message}</p>}
      </div>

      {scheduled && info.data && (
        <div className="panel font-mono text-sm space-y-3">
          {([['Release', info.data.release], ['Close', info.data.close]] as const).map(([label, s]) => (
            <div key={label}>
              <p className="label">{label}</p>
              <p>{s.name}</p>
              <p className="text-lab-dim">{s.local.replace('T', ' ')} {info.data.timezone}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
