import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export function PageHeader({ title, subtitle, actions, back }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {back && <div className="mb-2">{back}</div>}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-2xl sm:text-3xl [overflow-wrap:anywhere]">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-fg-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function EmptyState({ icon = 'queue', title, children, action }: {
  icon?: IconName; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="mb-3 rounded-full bg-raised p-3 text-fg-muted"><Icon name={icon} size={24} /></span>
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-fg-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/60 bg-danger-tint/60 p-4 text-danger">
      <Icon name="alert" size={20} />
      <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{message}</p>
      {onRetry && <Button variant="danger" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Notice({ tone = 'warn', icon = 'alert', children, className }: {
  tone?: 'warn' | 'danger' | 'ok' | 'info'; icon?: IconName; children: ReactNode; className?: string;
}) {
  const tones = {
    warn: 'border-warn/50 bg-warn-tint/50 text-warn',
    danger: 'border-danger/60 bg-danger-tint/60 text-danger',
    ok: 'border-ok/50 bg-ok-tint/60 text-ok',
    info: 'border-info/50 bg-info-tint/60 text-info',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', tones[tone], className)}>
      <Icon name={icon} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx('relative overflow-hidden rounded-md bg-raised', className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-line to-transparent" />
    </div>
  );
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cx('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ProgressBar({ value, tone = 'ok', label }: { value: number; tone?: 'ok' | 'danger' | 'info' | 'warn'; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const fill = { ok: 'bg-ok', danger: 'bg-danger', info: 'bg-info', warn: 'bg-warn' }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      className="h-3 overflow-hidden rounded-full bg-raised border border-line">
      <div className={cx('h-full w-full origin-left rounded-full transition-transform duration-base', fill)} style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}
