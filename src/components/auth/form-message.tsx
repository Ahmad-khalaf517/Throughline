import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FormMessageProps {
  variant: 'error' | 'success';
  children: ReactNode;
}

export function FormMessage({ variant, children }: FormMessageProps) {
  const Icon = variant === 'error' ? CircleAlert : CircleCheck;
  return (
    <p
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg p-3 text-sm leading-relaxed',
        variant === 'error'
          ? 'bg-error-container text-on-error-container'
          : 'bg-surface-container text-on-surface',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
