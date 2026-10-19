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
import { QueryState } from '../components/QueryState';
import {
  Badge, Button, Card, CardHeader, Icon, LinkButton, Notice, PageHeader, ProgressBar, Skeleton, StatusBadge, cx, useToast,
} from '../components/ui';
import { formatDateTime } from '../lib/hooks';

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
  const syncing = useRef(false); // true while loading server text, which is not a user edit
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
          EditorView.contentAttributes.of({ 'aria-label': 'Paper template editor', 'aria-multiline': 'true' }),
          EditorState.readOnly.of(readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !syncing.current) onChangeRef.current(u.state.doc.toString());
          }),
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
      syncing.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
      syncing.current = false;
    }
  }, [value]);

  return <div ref={host} className="h-[32rem] overflow-auto rounded-md" />;
}

function Meter({ info }: { info: CapacityInfo }) {
  const pct = Math.min(100, (info.capacityBits / Math.max(info.requiredBits, 1)) * 100);
  const copiesOver = info.totalCopies > info.maxCopies;
  const copyPct = Math.min(100, (info.totalCopies / info.maxCopies) * 100);
  return (
    <Card className="space-y-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="eyebrow">Capacity</p>
          <p className={cx('data-num text-sm font-medium', info.sufficient ? 'text-ok' : 'text-danger')}>
            {info.capacityBits.toFixed(1)} / {info.requiredBits.toFixed(1)} bits
          </p>
        </div>
        <ProgressBar label="Fingerprint capacity" value={pct} tone={info.sufficient ? 'ok' : 'danger'} />
        {info.sufficient
          ? <p className="mt-2 flex items-center gap-1.5 text-xs text-ok"><Icon name="check" size={14} />Enough variation for {info.plannedCopies} unique copies.</p>
          : <p className="mt-2 flex items-center gap-1.5 text-xs text-warn"><Icon name="alert" size={14} />Too few variation points: generation is blocked until capacity ≥ required.</p>}
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="eyebrow">Copies</p>
          <p className={cx('data-num text-sm font-medium', copiesOver ? 'text-danger' : 'text-fg')}>{info.totalCopies} / {info.maxCopies} copies</p>
        </div>
        <ProgressBar label="Copies allocated" value={copyPct} tone={copiesOver ? 'danger' : info.totalCopies === info.maxCopies ? 'warn' : 'info'} />
      </div>
      <div className="flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-fg-muted">variation points</span>
        <span className="data-num text-xl font-semibold">{info.points.length}</span>
      </div>
    </Card>
  );
}

interface Side { serial: number; text: string; ranges: Array<{ start: number; end: number }> }

function Highlighted({ side, label }: { side: Side; label: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  side.ranges.forEach((r, i) => {
    parts.push(side.text.slice(cursor, r.start));
    parts.push(<mark key={i} className="diff-hit">{side.text.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  parts.push(side.text.slice(cursor));
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <Badge tone="info" icon="eye">{label}</Badge>
        <span className="data-num text-sm text-fg-muted">copy #{side.serial}</span>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{parts}</pre>
    </Card>
  );
}

export default function EditorPage({ user }: { user: User }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
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
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['exam', id] }); toast.push('Template saved'); },
    onError: (e) => setError((e as Error).message),
  });
  const spot = useMutation({
    mutationFn: () => api<{ a: Side; b: Side }>(`/exams/${id}/spot-the-difference`),
    onSuccess: setDiff,
    onError: (e) => setError((e as Error).message),
  });

  return (
    <QueryState query={exam} skeleton={<div className="space-y-4"><Skeleton className="h-16 w-2/3" /><Skeleton className="h-[32rem]" /></div>}>
      {(e) => {
        const info: CapacityInfo | null = live ?? e.template;
        return (
          <div>
            <PageHeader
              title={e.title}
              subtitle={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge status={e.status} />
                  <span>{e.subject} · {formatDateTime(e.startsAt)} · {e.durationMin} min{e.template && ` · template v${e.template.version}`}</span>
                </span>
              }
              actions={user.role === 'CONTROLLER' && (
                <>
                  <LinkButton to={`/exams/${id}/generation`} icon="cog">Generation</LinkButton>
                  <LinkButton to={`/exams/${id}/schedule`} icon="clock">Schedule</LinkButton>
                  <Button icon="eye" disabled={!e.template} loading={spot.isPending} onClick={() => spot.mutate()}>Spot the difference</Button>
                  <Button variant="primary" icon="check" disabled={!canEdit || !dirty} loading={save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
                  </Button>
                </>
              )}
            />
            {!canEdit && user.role === 'CONTROLLER' && <Notice icon="lock" className="mb-4">Template is locked: exam is {e.status}.</Notice>}
            {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 space-y-6">
                <section aria-label="Template editor">
                  <p className="eyebrow mb-2">Template</p>
                  <DslEditor value={source} readOnly={!canEdit} onChange={(v) => { setSource(v); setDirty(true); }} />
                </section>
                <Card>
                  <CardHeader title="Live preview">Copy with the first alternative everywhere.</CardHeader>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {live?.preview ?? 'Write a template to see the preview.'}
                  </pre>
                </Card>
              </div>
              <aside className="space-y-6" aria-label="Capacity and syntax">
                {info && <Meter info={info} />}
                <Card>
                  <p className="eyebrow mb-3">Syntax</p>
                  <dl className="space-y-2 text-sm">
                    <div><dt className="data-num text-warn">{'{{Calculate|Compute}}'}</dt><dd className="text-fg-muted">phrase</dd></div>
                    <div><dt className="data-num text-warn">{'{{,|}}'}</dt><dd className="text-fg-muted">optional token</dd></div>
                    <div><dt className="data-num text-warn">{'{{10|ten}}'}</dt><dd className="text-fg-muted">number style</dd></div>
                    <div><dt className="data-num text-ok">::options … ::end</dt><dd className="text-fg-muted">MCQ order</dd></div>
                    <div><dt className="data-num text-ok">::shuffle … ::end</dt><dd className="text-fg-muted">question order</dd></div>
                  </dl>
                </Card>
              </aside>
            </div>

            {diff && (
              <section className="mt-8" aria-label="Spot the difference">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h2 className="text-xl">Spot the difference</h2>
                  <p className="text-sm text-fg-muted">Highlighted words differ between the two copies.</p>
                  <div className="ml-auto flex gap-2">
                    <Button icon="refresh" loading={spot.isPending} onClick={() => spot.mutate()}>Another pair</Button>
                    <Button variant="ghost" icon="close" onClick={() => setDiff(null)}>Close</Button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Highlighted side={diff.a} label="Copy A" />
                  <Highlighted side={diff.b} label="Copy B" />
                </div>
              </section>
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
