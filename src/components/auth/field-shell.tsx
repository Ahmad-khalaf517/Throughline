import type { ReactNode } from 'react';

interface FieldShellProps {
  id: string;
  label: string;
  helperText?: string | undefined;
  errorText?: string | undefined;
  children: ReactNode;
}

/**
 * Shared label + helper/error scaffolding for `TextField` and
 * `TextAreaField` - same wrapper, label, and helper/error paragraph either
 * way, just a different control in between. Extracted here (rather than
 * `components/projects`) because this is where the other shared field
 * primitives already live.
 */
export function FieldShell({ id, label, helperText, errorText, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-on-surface text-sm font-medium">
        {label}
      </label>
      {children}
      {(helperText || errorText) && (
        <p className={errorText ? 'text-error text-xs' : 'text-secondary text-xs'}>
          {errorText || helperText}
        </p>
      )}
    </div>
  );
}
