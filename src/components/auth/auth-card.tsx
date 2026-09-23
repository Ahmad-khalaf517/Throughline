import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/icons/logo-mark';
import { cn } from '@/lib/utils';

interface AuthCardProps {
  title: string;
  description?: string;
  /** Short archival-style tag shown top-right, e.g. "SEC-AUTH" (matches the Stitch recovery-flow screens). */
  badge?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AuthCard({
  title,
  description,
  badge,
  footer,
  children,
  className,
}: AuthCardProps) {
  return (
    <div
      className={cn(
        'bg-surface-container-lowest w-full rounded-xl p-8 shadow-[0_1px_3px_rgba(28,25,23,0.06),0_8px_24px_rgba(28,25,23,0.05)]',
        className,
      )}
    >
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/"
          aria-label="Throughline home"
          className="transition-opacity hover:opacity-80"
        >
          <LogoMark className="h-6" />
        </Link>
        {badge && (
          <span className="bg-surface-container font-mono-code text-on-surface-variant inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium">
            <span className="bg-primary-container size-1.5 rounded-full" aria-hidden="true" />
            {badge}
          </span>
        )}
      </div>

      <h1 className="text-on-surface text-[28px] leading-9 font-semibold tracking-tight">
        {title}
      </h1>
      {description && (
        <p className="text-on-surface-variant mt-2 text-sm leading-relaxed">{description}</p>
      )}

      <div className="mt-6">{children}</div>

      {footer && (
        <div className="border-surface-dim text-secondary mt-6 border-t pt-6 text-center text-sm">
          {footer}
        </div>
      )}
    </div>
  );
}
