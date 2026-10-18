import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, type ExamDetail } from '../api';

interface GenerationStatus {
  examStatus: string;
  job: { id: string; total: number; done: number; failed: number; status: string } | null;
  queueDepth: number;
  deadLetterDepth: number;
  workers: { desired: number; inService: number };
}

export default function GenerationPage() {
  const { id } = useParams();
  const qc = useQueryClient();
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
  const generate = useMutation({ mutationFn: () => api(`/exams/${id}/generate`, { method: 'POST' }), onSuccess: refresh });
  const rerender = useMutation({ mutationFn: () => api(`/exams/${id}/rerender`, { method: 'POST' }), onSuccess: refresh });

  const s = status.data;
  const job = s?.job;
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const t = exam.data?.template;
  const blocked = !t ? 'Save a template first.' : !t.sufficient ? 'Template capacity is too low.' : '';
  const error = (generate.error ?? rerender.error) as Error | null;
  const workersOk = (s?.workers.inService ?? 0) > 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to={`/exams/${id}`} className="font-mono text-sm text-lab-dim hover:text-white">← editor</Link>
        <h2 className="font-mono text-lg">Generation · {exam.data?.title}</h2>
      </div>

      <div className="panel space-y-4">
        <div>
          <div className="flex justify-between font-mono text-xs mb-1">
            <span>{job ? `${job.status} · ${job.done} / ${job.total} copies` : 'no job yet'}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-3 rounded bg-lab-line overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 font-mono text-sm">
          <div><dt className="label">Queue depth</dt><dd>{s?.queueDepth ?? '–'}</dd></div>
          <div>
            <dt className="label">Workers online</dt>
            <dd className={workersOk ? 'text-emerald-400' : 'text-amber-400'}>
              {s ? `${s.workers.inService} / ${s.workers.desired}` : '–'}
            </dd>
          </div>
          <div>
            <dt className="label">Dead letters</dt>
            <dd className={s?.deadLetterDepth ? 'text-red-400' : ''}>{s?.deadLetterDepth ?? '–'}</dd>
          </div>
        </dl>

        {s && !workersOk && s.queueDepth > 0 && (
          <p className="font-mono text-xs text-amber-400">No worker is running. Start one with: npm run dev --workspace @leaktrace/worker</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!!blocked || s?.examStatus !== 'DRAFT' || generate.isPending}
            onClick={() => generate.mutate()}>Generate</button>
          <button className="btn" disabled={!job || rerender.isPending} onClick={() => rerender.mutate()}>Re-render</button>
          <a className={`btn ${job ? '' : 'pointer-events-none opacity-40'}`} href={`/api/exams/${id}/demo-set`}>Demo set (5 copies, zip)</a>
        </div>
        {blocked && <p className="font-mono text-xs text-amber-400">{blocked}</p>}
        {error && <p className="font-mono text-sm text-red-400" role="alert">{error.message}</p>}
        <p className="font-mono text-xs text-lab-dim">
          Re-render rebuilds every PDF from the stored vectors; the output is byte-identical, which makes it a safe way to demo the worker.
        </p>
      </div>
    </div>
  );
}
