import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Exam } from '../api';

interface AuditRow {
  id: string; at: string; actor: string; action: string; entity: string;
  entityId: string | null; details: Record<string, unknown>; denied: boolean; examId: string | null;
}

const TYPES = [
  '', 'LOGIN', 'LOGIN_FAILED', 'EXAM_CREATED', 'TEMPLATE_SAVED', 'GENERATION_STARTED', 'RERENDER_STARTED',
  'EXAM_SCHEDULED', 'EXAM_RELEASED', 'EXAM_CLOSED', 'DOWNLOAD', 'DOWNLOAD_DENIED', 'PAPER_DOWNLOADED',
];

export default function AuditPage() {
  const [examId, setExamId] = useState('');
  const [type, setType] = useState('');
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<Exam[]>('/exams') });
  const rows = useQuery({
    queryKey: ['audit', examId, type],
    queryFn: () => api<AuditRow[]>(`/audit?examId=${examId}&type=${type}`),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="font-mono text-lg mr-4">Audit log</h2>
        <div><label className="label">Exam</label>
          <select className="input" value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">All exams</option>
            {exams.data?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select></div>
        <div><label className="label">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}
          </select></div>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="w-full font-mono text-xs">
          <thead className="text-lab-dim text-left">
            <tr><th className="p-2">Time</th><th>Actor</th><th>Action</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => (
              <tr key={r.id} className={`border-t border-lab-line align-top ${r.denied ? 'bg-red-950/50 text-red-300' : ''}`}>
                <td className="p-2 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
                <td>{r.actor}</td>
                <td className="whitespace-nowrap">{r.action}</td>
                <td className="text-lab-dim break-all pr-2">{JSON.stringify(r.details)}</td>
              </tr>
            ))}
            {rows.data?.length === 0 && <tr><td className="p-3 text-lab-dim" colSpan={4}>No events.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
