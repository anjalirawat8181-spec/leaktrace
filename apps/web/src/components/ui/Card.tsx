import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

type Tone = 'default' | 'ok' | 'warn' | 'danger';
const tones: Record<Tone, string> = {
  default: 'border-line',
  ok: 'border-ok/50 bg-ok-tint/40',
  warn: 'border-warn/50 bg-warn-tint/40',
  danger: 'border-danger/60 bg-danger-tint/50',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  padded?: boolean;
}

export function Card({ tone = 'default', padded = true, className, ...rest }: CardProps) {
  return <div className={cx('min-w-0 rounded-lg border bg-surface shadow-card', tones[tone], padded && 'p-4 sm:p-6', className)} {...rest} />;
}

export function CardHeader({ title, action, children }: { title: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg">{title}</h2>
        {children && <p className="mt-1 text-sm text-fg-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}
