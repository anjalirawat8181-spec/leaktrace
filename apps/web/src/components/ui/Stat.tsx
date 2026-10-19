import type { ReactNode } from 'react';
import { cx } from './cx';

export function Stat({ label, value, hint, tone, className }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger'; className?: string;
}) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-fg';
  return (
    <div className={cx('rounded-lg border border-line bg-bg/60 p-4', className)}>
      <dt className="eyebrow">{label}</dt>
      <dd className={cx('mt-1 font-mono text-2xl font-semibold tabular-nums', color)}>{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-fg-muted">{hint}</dd>}
    </div>
  );
}
