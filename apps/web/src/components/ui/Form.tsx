import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

const control = 'w-full min-h-11 rounded-md border border-line-strong bg-bg px-3 py-2 text-base text-fg '
  + 'placeholder:text-fg-muted/70 transition-colors duration-fast hover:border-fg-muted '
  + 'disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-danger lg:min-h-10 lg:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest }, ref,
) {
  return <input ref={ref} className={cx(control, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest }, ref,
) {
  return <textarea ref={ref} className={cx(control, 'font-mono', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest }, ref,
) {
  return <select ref={ref} className={cx(control, 'pr-8', className)} {...rest} />;
});

export function Field({ label, hint, error, className, id: fixedId, children }: {
  label: string; id?: string; hint?: string; error?: string; className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const generated = useId();
  const id = fixedId ?? generated;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg-muted">{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? <p id={`${id}-err`} className="mt-1 text-sm text-danger" role="alert">{error}</p>
        : hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}
