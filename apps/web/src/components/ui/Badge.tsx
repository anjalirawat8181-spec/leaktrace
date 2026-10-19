import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-raised text-fg-muted border-line-strong',
  ok: 'bg-ok-tint text-ok border-ok/50',
  warn: 'bg-warn-tint text-warn border-warn/50',
  danger: 'bg-danger-tint text-danger border-danger/50',
  info: 'bg-info-tint text-info border-info/50',
};

export function Badge({ tone = 'neutral', icon, children, className }: {
  tone?: Tone; icon?: IconName; children: ReactNode; className?: string;
}) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium', tones[tone], className)}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; icon: IconName }> = {
  DRAFT: { tone: 'neutral', icon: 'pencil' },
  GENERATING: { tone: 'info', icon: 'cog' },
  READY: { tone: 'ok', icon: 'check' },
  SCHEDULED: { tone: 'warn', icon: 'clock' },
  RELEASED: { tone: 'ok', icon: 'unlock' },
  CLOSED: { tone: 'neutral', icon: 'lock' },
  IDENTIFIED: { tone: 'danger', icon: 'target' },
  POSSIBLE: { tone: 'warn', icon: 'question' },
  INSUFFICIENT: { tone: 'neutral', icon: 'minus' },
  INCONCLUSIVE: { tone: 'warn', icon: 'question' },
  OPEN: { tone: 'info', icon: 'eye' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, icon: undefined };
  return <Badge tone={s.tone} icon={s.icon}>{status}</Badge>;
}
