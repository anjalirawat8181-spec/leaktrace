import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import {
  Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, lineNumbers, type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type CapacityInfo, type ExamDetail, type User } from '../api';

const pointMatcher = new MatchDecorator({
  regexp: /\{\{[^}]*\}\}|^::(?:options|shuffle|end)\b/gm,
  decoration: (m) => Decoration.mark({ class: m[0].startsWith('::') ? 'cm-directive' : 'cm-point' }),
});

const highlightPoints = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = pointMatcher.createDeco(view); }
    update(u: ViewUpdate) { this.decorations = pointMatcher.updateDeco(u, this.decorations); }
  },
  { decorations: (v) => v.decorations },
);

function DslEditor({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping, highlightPoints,
          EditorState.readOnly.of(readOnly),
          EditorView.updateListener.of((u) => u.docChanged && onChangeRef.current(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Load server text once it arrives without clobbering the user's typing.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value && !v.hasFocus) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-[34rem] overflow-auto" />;
}

function Meter({ info }: { info: CapacityInfo }) {
  const pct = Math.min(100, (info.capacityBits / Math.max(info.requiredBits, 1)) * 100);
  const copiesOver = info.totalCopies > info.maxCopies;
  return (
    <div className="panel space-y-3">
      <div>
        <div className="flex justify-between font-mono text-xs mb-1">
          <span>capacity</span>
          <span className={info.sufficient ? 'text-emerald-400' : 'text-red-400'}>
            {info.capacityBits.toFixed(1)} / {info.requiredBits.toFixed(1)} bits
          </span>
        </div>
        <div className="h-2 rounded bg-lab-line overflow-hidden">
          <div className={`h-full ${info.sufficient ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
        </div>
        {!info.sufficient && (
          <p className="font-mono text-xs text-amber-400 mt-2">
            Too few variation points: generation is blocked until capacity ≥ required.
          </p>
        )}
      </div>
      <div className="font-mono text-sm flex justify-between">
        <span className="text-lab-dim">copies</span>
        <span className={copiesOver ? 'text-red-400' : ''}>{info.totalCopies} / {info.maxCopies} copies</span>
      </div>
      <div className="font-mono text-sm flex justify-between">
        <span className="text-lab-dim">variation points</span><span>{info.points.length}</span>
      </div>
    </div>
  );
}

interface Side { serial: number; text: string; ranges: Array<{ start: number; end: number }> }

function Highlighted({ side }: { side: Side }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  side.ranges.forEach((r, i) => {
    parts.push(side.text.slice(cursor, r.start));
    parts.push(<mark key={i} className="diff-hit">{side.text.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  parts.push(side.text.slice(cursor));
  return (
    <div className="panel">
      <p className="font-mono text-xs text-lab-dim mb-2">copy #{side.serial}</p>
      <pre className="whitespace-pre-wrap font-sans text-sm">{parts}</pre>
    </div>
  );
}

export default function EditorPage({ user }: { user: User }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamDetail>(`/exams/${id}`) });
  const canEdit = user.role === 'CONTROLLER' && exam.data?.status === 'DRAFT';

  const [source, setSource] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<(CapacityInfo & { preview: string }) | null>(null);
  const [error, setError] = useState('');
  const [diff, setDiff] = useState<{ a: Side; b: Side } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (exam.data && !loaded) {
      setSource(exam.data.template?.source ?? '');
      setLoaded(true);
    }
  }, [exam.data, loaded]);

  // Debounced live parse (not saved).
  useEffect(() => {
    if (!loaded || user.role !== 'CONTROLLER' || !source.trim()) { setLive(null); return; }
    const t = setTimeout(async () => {
      try {
        setLive(await api(`/exams/${id}/template/preview`, { method: 'POST', json: { source } }));
        setError('');
      } catch (e) {
        setError((e as Error).message);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [source, loaded, id, user.role]);

  const save = useMutation({
    mutationFn: () => api(`/exams/${id}/template`, { method: 'PUT', json: { source } }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['exam', id] }); },
    onError: (e) => setError((e as Error).message),
  });
  const spot = useMutation({
    mutationFn: () => api<{ a: Side; b: Side }>(`/exams/${id}/spot-the-difference`),
    onSuccess: setDiff,
    onError: (e) => setError((e as Error).message),
  });

  if (!exam.data) return <p className="font-mono text-lab-dim">loading…</p>;
  const e = exam.data;
  const info: CapacityInfo | null = live ?? e.template;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-semibold text-lg">{e.title}</h2>
          <p className="font-mono text-xs text-lab-dim">
            {e.subject} · {new Date(e.startsAt).toLocaleString()} · {e.durationMin} min · {e.status}
            {e.template && ` · template v${e.template.version}`}
          </p>
        </div>
        {user.role === 'CONTROLLER' && (
          <div className="ml-auto flex gap-2">
            <button className="btn" disabled={!e.template || spot.isPending} onClick={() => spot.mutate()}>
              Spot the difference
            </button>
            <button className="btn btn-primary" disabled={!canEdit || !dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
            </button>
          </div>
        )}
      </div>
      {!canEdit && user.role === 'CONTROLLER' && (
        <p className="font-mono text-xs text-amber-400">Template is locked: exam is {e.status}.</p>
      )}
      {error && <p className="font-mono text-sm text-red-400" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4 min-w-0">
          <DslEditor value={source} readOnly={!canEdit} onChange={(v) => { setSource(v); setDirty(true); }} />
          <div className="panel">
            <p className="label">Live preview (copy with first alternative everywhere)</p>
            <pre className="whitespace-pre-wrap font-sans text-sm max-h-80 overflow-auto">
              {live?.preview ?? 'Write a template to see the preview.'}
            </pre>
          </div>
        </div>
        <aside className="space-y-4">
          {info && <Meter info={info} />}
          <div className="panel font-mono text-xs space-y-1 text-lab-dim">
            <p className="label">Syntax</p>
            <p>{'{{Calculate|Compute}}'} phrase</p>
            <p>{'{{,|}}'} optional token</p>
            <p>{'{{10|ten}}'} number style</p>
            <p>::options … ::end · MCQ order</p>
            <p>::shuffle … ::end · question order</p>
          </div>
        </aside>
      </div>

      {diff && (
        <div className="space-y-2">
          <div className="flex items-center">
            <h3 className="font-mono">Spot the difference</h3>
            <button className="btn ml-auto" onClick={() => spot.mutate()}>Another pair</button>
            <button className="btn ml-2" onClick={() => setDiff(null)}>Close</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Highlighted side={diff.a} />
            <Highlighted side={diff.b} />
          </div>
        </div>
      )}
    </div>
  );
}
