import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';

export function Table({ caption, children, className }: { caption?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-lg border border-line bg-surface shadow-card', className)} tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cx('bg-raised px-4 py-2.5 font-mono text-xs font-medium uppercase tracking-wider text-fg-muted', className)} {...rest} />;
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('px-4 py-2.5 align-top', className)} {...rest} />;
}

export function Tr({ tone, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { tone?: 'danger' }) {
  return <tr className={cx('border-t border-line', tone === 'danger' ? 'bg-danger-tint/60 text-danger' : 'hover:bg-raised/60', className)} {...rest} />;
}
