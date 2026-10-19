import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none '
  + 'transition-colors duration-fast disabled:opacity-50 disabled:pointer-events-none touch-manipulation';
const variants: Record<Variant, string> = {
  primary: 'bg-ok text-on-accent hover:bg-ok/85',
  secondary: 'bg-raised text-fg border border-line-strong hover:border-fg-muted hover:bg-line',
  ghost: 'text-fg-muted hover:text-fg hover:bg-raised',
  danger: 'bg-danger-tint text-danger border border-danger/60 hover:bg-danger/20',
};
const sizes: Record<Size, string> = {
  md: 'min-h-11 px-4 text-sm lg:min-h-10',
  lg: 'min-h-14 px-6 text-base',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra?: string) {
  return cx(base, variants[variant], sizes[size], extra);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
        : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});

interface LinkButtonProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
}

export function LinkButton({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}
