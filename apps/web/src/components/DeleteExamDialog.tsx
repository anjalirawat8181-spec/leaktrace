import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Card, Icon, Input, Notice, useToast } from './ui';

export function DeleteExamDialog({ exam, onClose, onDeleted }: {
  exam: { id: string; title: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const matches = typed.trim() === exam.title.trim();

  const remove = useMutation({
    mutationFn: () => api<{ filesFailed: number }>(`/exams/${exam.id}`, { method: 'DELETE', json: { confirmTitle: typed } }),
    onSuccess: (res) => {
      qc.removeQueries({ queryKey: ['exam', exam.id] });
      qc.invalidateQueries({ queryKey: ['exams'] });
      qc.invalidateQueries({ queryKey: ['centre-exams'] });
      toast.push(res.filesFailed ? 'Exam deleted. Some PDF files could not be removed; they are listed in the server log.' : 'Exam deleted', res.filesFailed ? 'info' : 'ok');
      onDeleted();
    },
  });

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !remove.isPending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, remove.isPending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (matches) remove.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !remove.isPending) onClose(); }}>
      <Card className="w-full max-w-lg" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger-tint text-danger"><Icon name="trash" /></span>
            <div className="min-w-0">
              <h2 id="delete-title" className="text-xl">Delete this exam?</h2>
              <p className="mt-1 text-sm text-fg-muted [overflow-wrap:anywhere]">{exam.title}</p>
            </div>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>The paper, all generated copies and their PDF files are removed.</li>
            <li>Trace cases for this exam are removed and its schedule is cancelled.</li>
            <li>It disappears from every screen, including the superintendents'.</li>
            <li>The audit log keeps its history and records who deleted it.</li>
          </ul>
          <div>
            <label htmlFor="confirm-title" className="mb-1.5 block text-sm font-medium">
              Type the exam title to confirm
            </label>
            <Input id="confirm-title" ref={input} value={typed} onChange={(e) => setTyped(e.target.value)}
              autoComplete="off" placeholder={exam.title} aria-describedby="confirm-hint" />
            <p id="confirm-hint" className="mt-1 text-xs text-fg-muted">This cannot be undone.</p>
          </div>
          {remove.error && <Notice tone="danger">{(remove.error as Error).message}</Notice>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose} disabled={remove.isPending}>Cancel</Button>
            <Button type="submit" variant="danger" icon="trash" disabled={!matches} loading={remove.isPending}>Delete exam</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
