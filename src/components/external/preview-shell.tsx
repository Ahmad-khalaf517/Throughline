'use client';

import Link from 'next/link';
import { CircleAlert, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'prerequisite-not-met'; message: string; reviewHref: string }
  | { status: 'ready' };

interface PreviewShellProps {
  state: PreviewState;
  children: ReactNode;
}

/**
 * The shared four-state shell for every external-write preview screen
 * (E5-S9; screen-kit skill's "every screen needs four states"). `children`
 * (the panel's real preview/write UI) only ever renders in the `ready`
 * state.
 *
 * `prerequisite-not-met` (a `409 PREREQUISITE_NOT_APPROVED`, TR FR-080) is
 * deliberately styled apart from `error` - it's "approve X first," not a
 * failure - and links straight to the artifact that needs approving
 * (`/projects/:id/artifacts/{architecture|backlog|ui_requirements}`,
 * `artifacts/[type]/page.tsx`).
 */
export function PreviewShell({ state, children }: PreviewShellProps) {
  if (state.status === 'loading') {
    return (
      <div className="border-surface-dim bg-surface-container-lowest flex items-center gap-2 rounded-xl border p-6">
        <Loader2 className="text-on-surface-variant size-4 animate-spin" aria-hidden="true" />
        <p className="text-on-surface-variant text-sm">Loading preview…</p>
      </div>
    );
  }

  if (state.status === 'prerequisite-not-met') {
    return (
      <div className="border-status-draft-border bg-status-draft-bg flex flex-col items-start gap-2 rounded-xl border border-dashed p-6">
        <p className="text-on-surface text-sm font-medium">{state.message}</p>
        <Link
          href={state.reviewHref}
          className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          Review and approve →
        </Link>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="bg-error-container flex items-start gap-2 rounded-xl p-6">
        <CircleAlert
          className="text-on-error-container mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <p className="text-on-error-container text-sm font-medium">{state.message}</p>
      </div>
    );
  }

  return <>{children}</>;
}
