'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plug } from 'lucide-react';
import { CONNECTIONS_PATH, type IntegrationsSummary } from '@/lib/connections-ui';

/**
 * The persistent header entry for the Integrations screen (icon + text, never
 * icon-only). When something is not fully connected it carries a small
 * "n/3" count with the full sentence as visually hidden text, so the hint is
 * text and shape, not colour alone. `summary` holds only status counts computed
 * on the server - never a token or account detail.
 */
export function IntegrationsNavLink({ summary }: { summary: IntegrationsSummary | null }) {
  const pathname = usePathname();
  const active = pathname === CONNECTIONS_PATH;

  return (
    <Link
      href={CONNECTIONS_PATH}
      aria-current={active ? 'page' : undefined}
      className={`hover:bg-surface-container-low focus-visible:ring-primary flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none ${
        active ? 'text-on-surface bg-surface-container-low' : 'text-on-surface-variant'
      }`}
    >
      <Plug className="size-4 shrink-0" aria-hidden="true" />
      <span>Integrations</span>
      {summary?.attention && (
        <>
          <span
            aria-hidden="true"
            className="border-status-draft-border bg-status-draft-bg text-status-draft-text rounded-full border border-dashed px-1.5 text-[10px] leading-4 font-semibold"
          >
            {summary.connected}/{summary.total}
          </span>
          <span className="sr-only">{summary.hint}</span>
        </>
      )}
    </Link>
  );
}
