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
    <div>
      <PageHeader title="Audit log" subtitle="Every action and every denied attempt. Refreshes every 5 seconds." />
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
                {TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}
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
                    {r.denied ? <Badge tone="danger" icon="alert">{r.action}</Badge> : <span className="data-num text-xs">{r.action}</span>}
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
