import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Exam } from '../api';
import { QueryState } from '../components/QueryState';
import { Badge, Card, EmptyState, Field, PageHeader, Select, SkeletonRows, Table, Td, Th, Tr } from '../components/ui';
import { formatDateTime } from '../lib/hooks';

interface AuditRow {
  id: string; at: string; actor: string; action: string; entity: string;
  entityId: string | null; details: Record<string, unknown>; denied: boolean; examId: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Signed in', LOGIN_FAILED: 'Failed sign-in', EXAM_CREATED: 'Exam created', TEMPLATE_SAVED: 'Paper saved',
  GENERATION_STARTED: 'Copy generation started', RERENDER_STARTED: 'Copies made again', EXAM_SCHEDULED: 'Release scheduled',
  EXAM_RELEASED: 'Paper released', EXAM_CLOSED: 'Downloads closed', EXAM_DELETED: 'Exam deleted', DOWNLOAD: 'Paper downloaded',
  DOWNLOAD_DENIED: 'Download blocked', PAPER_DOWNLOADED: 'Papers downloaded', TRACE_CASE_CREATED: 'Leak case opened',
  TRACE_RUN: 'Leak trace run', LEAK_IDENTIFIED: 'Leak traced to a copy', TRACE_EVIDENCE_REGISTERED: 'Evidence photo added',
  TRACE_EVIDENCE_MISMATCH: 'Evidence photo did not match', DEMO_SET_DOWNLOADED: 'Sample copies downloaded',
  CENTRE_CREATED: 'Centre added', CENTRE_UPDATED: 'Centre changed', CENTRE_DELETED: 'Centre removed',
  ROOM_CREATED: 'Room added', ROOM_UPDATED: 'Room changed', ROOM_DELETED: 'Room removed',
};
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

const TYPES = [
  '', 'LOGIN', 'LOGIN_FAILED', 'EXAM_CREATED', 'TEMPLATE_SAVED', 'GENERATION_STARTED', 'RERENDER_STARTED',
  'EXAM_SCHEDULED', 'EXAM_RELEASED', 'EXAM_CLOSED', 'EXAM_DELETED', 'DOWNLOAD', 'DOWNLOAD_DENIED', 'PAPER_DOWNLOADED',
  'TRACE_RUN', 'LEAK_IDENTIFIED',
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
    <div>
      <PageHeader title="Audit log" subtitle="A permanent record of what happened, newest first. Red rows are blocked attempts." />
      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam">
            {(p) => (
              <Select {...p} value={examId} onChange={(e) => setExamId(e.target.value)}>
                <option value="">All exams</option>
                {exams.data?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Type">
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t ? actionLabel(t) : 'Everything'}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </Card>
      <QueryState query={rows} skeleton={<SkeletonRows rows={6} />}>
        {(list) => list.length === 0 ? (
          <EmptyState icon="audit" title="No events">No audit events match these filters.</EmptyState>
        ) : (
          <Table caption="Audit events">
            <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Details</Th></tr></thead>
            <tbody>
              {list.map((r) => (
                <Tr key={r.id} tone={r.denied ? 'danger' : undefined}>
                  <Td className="whitespace-nowrap data-num text-xs">{formatDateTime(r.at)}</Td>
                  <Td className="whitespace-nowrap">{r.actor}</Td>
                  <Td className="whitespace-nowrap">
                    {r.denied ? <Badge tone="danger" icon="alert">{actionLabel(r.action)}</Badge> : <span className="text-sm">{actionLabel(r.action)}</span>}
                    <span className="data-num mt-1 block text-xs text-fg-muted">{r.action}</span>
                  </Td>
                  <Td className="min-w-64 data-num text-xs text-fg-muted [overflow-wrap:anywhere]">{JSON.stringify(r.details)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryState>
    </div>
  );
}
