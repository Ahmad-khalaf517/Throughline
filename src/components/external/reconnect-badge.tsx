import Link from 'next/link';
import { PlugZap } from 'lucide-react';
import { CONNECTIONS_PATH, describeNeedsReconnect, PROVIDER_LABEL } from '@/lib/connections-ui';
import type { ExternalOperationDTO } from '@/lib/serialize';

/**
 * FR-090 "reconnect required" state for an operation/ref whose recorded
 * connection cannot be used. Neutral by design: it uses the plug icon and the
 * draft-style dashed neutral surface, never the failed (error) styling and never
 * the flagged/impact glyph - a lapsed credential says nothing about whether any
 * planning work changed, and the operation itself is unchanged.
 */
export function ReconnectBadge({
  needsReconnect,
}: {
  needsReconnect: ExternalOperationDTO['needsReconnect'] | undefined;
}) {
  const copy = describeNeedsReconnect(needsReconnect);
  if (!copy) return null;

  return (
    <div className="border-status-draft-border bg-status-draft-bg text-status-draft-text flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-2.5 py-1.5 text-xs">
      <span className="inline-flex items-center gap-1 font-medium">
        <PlugZap className="size-3.5" aria-hidden="true" />
        {copy.label}
      </span>
      <span>
        {PROVIDER_LABEL[copy.provider]}: {copy.reason}.
      </span>
      <Link
        href={CONNECTIONS_PATH}
        className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        Open Connections →
      </Link>
    </div>
  );
}
