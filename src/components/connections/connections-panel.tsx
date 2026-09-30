'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck, Link2Off, Loader2, X } from 'lucide-react';
import type { ConnectionDTO } from '@/lib/serialize';
import {
  availableActions,
  connectStartHref,
  describeConnectionStatus,
  PROVIDER_LABEL,
  PROVIDER_PURPOSE,
  type ConnectionProvider,
  type ConnectionsBanner,
} from '@/lib/connections-ui';
import { DisconnectDialog } from './disconnect-dialog';
import { StitchKeyForm } from './stitch-key-form';

interface ConnectionsPanelProps {
  initialConnections: ConnectionDTO[];
  /** Set when the server-side read failed; the panel then offers a retry. */
  loadFailed: boolean;
  banner: ConnectionsBanner | null;
}

const PRIMARY_LINK =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';
const SECONDARY_BUTTON =
  'border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The Integrations screen body (FR-087): one card per provider with status and
 * identity only. The connection list comes from the server page; after a
 * mutation it is re-read from `GET /api/connections` so the cards always show
 * what the server holds. No token, key or secret is ever received or shown - the
 * one secret that passes through here (the Stitch key) goes out in a single
 * `POST` and is dropped from state the moment it is sent.
 */
export function ConnectionsPanel({
  initialConnections,
  loadFailed,
  banner,
}: ConnectionsPanelProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<ConnectionDTO[] | null>(
    loadFailed ? null : initialConnections,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(loadFailed);
  const [notice, setNotice] = useState<ConnectionsBanner | null>(banner);
  const [disconnecting, setDisconnecting] = useState<ConnectionProvider | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/connections');
      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }
      if (!response.ok) throw new Error('bad status');
      const body = (await response.json()) as { connections: ConnectionDTO[] };
      setConnections(body.connections);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
            notice.kind === 'error'
              ? 'bg-error-container text-on-error-container'
              : 'bg-surface-container text-on-surface'
          }`}
        >
          {notice.kind === 'error' ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="flex-1">{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss message"
            className="focus-visible:ring-primary rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="bg-error-container text-on-error-container flex flex-wrap items-center gap-3 rounded-xl p-4 text-sm"
        >
          <span>Could not load your connections.</span>
          <button type="button" onClick={reload} disabled={loading} className={SECONDARY_BUTTON}>
            {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      {connections === null && !loadError && (
        <div className="border-surface-dim bg-surface-container-lowest flex items-center gap-2 rounded-xl border p-6">
          <Loader2 className="text-on-surface-variant size-4 animate-spin" aria-hidden="true" />
          <p className="text-on-surface-variant text-sm">Loading connections…</p>
        </div>
      )}

      {connections?.map((connection) => (
        <ProviderCard
          key={connection.provider}
          connection={connection}
          onDisconnect={() => setDisconnecting(connection.provider)}
          onStitchSaved={async () => {
            setNotice({ kind: 'success', message: 'Stitch connected.' });
            await reload();
          }}
        />
      ))}

      {disconnecting && (
        <DisconnectDialog
          provider={disconnecting}
          onClose={() => setDisconnecting(null)}
          onDone={async (message) => {
            setDisconnecting(null);
            setNotice({ kind: 'success', message });
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({
  connection,
  onDisconnect,
  onStitchSaved,
}: {
  connection: ConnectionDTO;
  onDisconnect: () => void;
  onStitchSaved: () => Promise<void>;
}) {
  const { provider } = connection;
  const label = PROVIDER_LABEL[provider];
  const copy = describeConnectionStatus(connection);
  const actions = availableActions(connection.status);
  const headingId = `connection-${provider}`;
  const oauth = provider === 'github' || provider === 'jira';

  // Status is never colour alone: an icon and the words carry it too.
  const StatusIcon =
    copy.tone === 'connected' ? CircleCheck : copy.tone === 'attention' ? CircleAlert : Link2Off;
  const toneClass =
    copy.tone === 'connected'
      ? 'text-success'
      : copy.tone === 'attention'
        ? 'text-error'
        : 'text-on-surface-variant';

  return (
    <section
      aria-labelledby={headingId}
      className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-on-surface text-base font-semibold">
            {label}
            <span className="text-on-surface-variant font-normal">
              {' '}
              - {PROVIDER_PURPOSE[provider].toLowerCase()}
            </span>
          </h2>
          <p className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${toneClass}`}>
            <StatusIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{copy.label}</span>
          </p>
          {copy.detail && (
            <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">{copy.detail}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {oauth && actions.includes('connect') && (
            <a href={connectStartHref(provider)} className={PRIMARY_LINK}>
              Connect {label}
            </a>
          )}
          {oauth && actions.includes('reconnect') && (
            <a href={connectStartHref(provider)} className={PRIMARY_LINK}>
              Reconnect {label}
            </a>
          )}
          {actions.includes('disconnect') && (
            <button
              type="button"
              onClick={onDisconnect}
              aria-label={`Disconnect ${label}`}
              className={SECONDARY_BUTTON}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {provider === 'stitch' && (
        <StitchKeyForm reconnect={connection.status !== 'none'} onSaved={onStitchSaved} />
      )}
    </section>
  );
}
