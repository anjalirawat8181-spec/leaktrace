import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Exam, type User } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Button, Card, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select, SkeletonRows, StatusBadge, Table, Td, Textarea, Th, Tr,
} from '../components/ui';
import { formatDateTime } from '../lib/hooks';

interface CaseRow {
  id: string; title: string; examTitle: string; status: 'OPEN' | 'IDENTIFIED' | 'INCONCLUSIVE'; createdAt: string;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function TraceLabPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const canRun = user.role === 'CONTROLLER';
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<Exam[]>('/exams'), enabled: canRun });
  const cases = useQuery({ queryKey: ['trace-cases'], queryFn: () => api<CaseRow[]>('/trace/cases') });

  const [examId, setExamId] = useState('');
  const [title, setTitle] = useState('');
  const [leakText, setLeakText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api<{ id: string }>('/trace/cases', {
        method: 'POST', json: { examId: examId || exams.data?.[0]?.id, title, leakText },
      });
      if (photo) {
        const sha256 = await sha256Hex(photo);
        const { url } = await api<{ url: string }>(`/trace/cases/${created.id}/evidence-url`, {
          method: 'POST', json: { sha256, contentType: photo.type },
        });
        const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': photo.type }, body: photo });
        if (!put.ok) throw new Error('Evidence upload failed');
      }
      navigate(`/trace/${created.id}?run=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Trace Lab" subtitle="Paste leaked text and find the copy it came from." />

      {canRun ? (
        <Card className="mb-8">
          <CardHeader title="New trace case">A few lines are enough; typos in the leak are tolerated.</CardHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Exam">
                {(p) => (
                  <Select {...p} value={examId} onChange={(e) => setExamId(e.target.value)}>
                    {exams.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Case title">
                {(p) => <Input {...p} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Telegram screenshot" />}
              </Field>
            </div>
            <Field label="Leaked text (paste a few lines)">
              {(p) => <Textarea {...p} className="h-48" required value={leakText} onChange={(e) => setLeakText(e.target.value)} />}
            </Field>
            <Field label="Photo evidence (optional)" hint="JPEG, PNG or WebP. The file is hashed in your browser and the hash is re-checked on the server.">
              {(p) => (
                <Input {...p} type="file" accept="image/png,image/jpeg,image/webp" className="file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-fg"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              )}
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" icon="trace" loading={busy} disabled={!leakText.trim() || !title.trim()}>
              {busy ? 'Preparing…' : 'Run trace'}
            </Button>
          </form>
        </Card>
      ) : (
        <Notice tone="info" icon="eye" className="mb-8">Read-only access: open a case below to review its result.</Notice>
      )}

      <h2 className="mb-3 text-xl">Cases</h2>
      <QueryState query={cases} skeleton={<SkeletonRows rows={3} />}>
        {(rows) => rows.length === 0 ? (
          <EmptyState icon="trace" title="No cases yet">Run a trace and it will be listed here.</EmptyState>
        ) : (
          <Table caption="Trace cases">
            <thead><tr><Th>Case</Th><Th>Exam</Th><Th>Status</Th><Th>Opened</Th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td><Link className="font-medium text-info underline-offset-4 hover:underline" to={`/trace/${c.id}`}>{c.title}</Link></Td>
                  <Td>{c.examTitle}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td className="whitespace-nowrap text-fg-muted">{formatDateTime(c.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryState>
    </div>
  );
}
