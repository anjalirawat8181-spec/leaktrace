import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

type ToastTone = 'ok' | 'danger' | 'info';
interface ToastItem { id: number; tone: ToastTone; message: string }
interface ToastApi { push: (message: string, tone?: ToastTone) => void }

const ToastContext = createContext<ToastApi>({ push: () => {} });
export const useToast = () => useContext(ToastContext);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((message: string, tone: ToastTone = 'ok') => {
    const id = ++counter;
    setItems((list) => [...list.slice(-3), { id, tone, message }]);
    setTimeout(() => dismiss(id), tone === 'danger' ? 8000 : 4500);
  }, [dismiss]);
  const api = useMemo(() => ({ push }), [push]);
  const tones = {
    ok: 'border-ok/60 text-ok', danger: 'border-danger/60 text-danger', info: 'border-info/60 text-info',
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:w-96" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg border bg-raised px-4 py-3 shadow-pop', tones[t.tone])}>
            <Icon name={t.tone === 'danger' ? 'alert' : 'check'} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1 text-sm text-fg [overflow-wrap:anywhere]">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"
              className="-m-2 rounded-md p-2 text-fg-muted hover:text-fg"><Icon name="close" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
