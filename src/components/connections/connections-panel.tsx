'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck, Link2, Link2Off, Loader2, X } from 'lucide-react';
import type { ConnectionDTO } from '@/lib/serialize';
import {
  availableActions,
  connectStartHref,
  describeConnectionStatus,
  describeDisconnectResult,
  describeStitchConnectError,
  PROVIDER_LABEL,
  type ConnectionProvider,
  type ConnectionsBanner,
} from '@/lib/connections-ui';

interface ConnectionsPanelProps {
  initialConnections: ConnectionDTO[];
  /** Set when the server-side read failed; the panel then offers a retry. */
  loadFailed: boolean;
  banner: ConnectionsBanner | null;
}

interface ErrorBody {
  error?: { code?: string };
}

const PRIMARY_LINK =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';
const SECONDARY_BUTTON =
  'border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const INPUT_CLASSNAME =
  'border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:ring-primary h-10 w-full rounded-lg border px-3.5 text-sm transition-colors focus:ring-1 focus:outline-none';

/**
 * The Connections screen body (FR-087): one card per provider with status and
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

      {disconnecting &&
        createPortal(
          <DisconnectDialog
            provider={disconnecting}
            onClose={() => setDisconnecting(null)}
            onDone={async (message) => {
              setDisconnecting(null);
              setNotice({ kind: 'success', message });
              await reload();
            }}
          />,
          document.body,
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

/**
 * The only place a provider secret is typed. The key lives in an uncontrolled
 * password input: it is read from the form once on submit and the field is
 * cleared straight away - success or failure - so it is never held in React
 * state, never logged, and never shown again (not even masked).
 */
function StitchKeyForm({
  reconnect,
  onSaved,
}: {
  reconnect: boolean;
  onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = inputRef.current;
    if (!input || pending) return;
    const apiKey = input.value.trim();
    if (apiKey === '') {
      setError('Enter a Stitch API key.');
      return;
    }

    setPending(true);
    setError(null);
    let outcome: 'saved' | 'unauthenticated' | string = 'error';
    try {
      const response = await fetch('/api/connections/stitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (response.status === 401) {
        outcome = 'unauthenticated';
      } else if (response.ok) {
        outcome = 'saved';
      } else {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        outcome = body?.error?.code ?? 'error';
      }
    } catch {
      outcome = 'network';
    } finally {
      // Cleared whatever happened; the key is not kept anywhere after submit.
      input.value = '';
    }

    if (outcome === 'unauthenticated') {
      router.push('/sign-in');
      return;
    }
    if (outcome === 'saved') {
      setPending(false);
      await onSaved();
      return;
    }
    setError(
      outcome === 'network'
        ? 'Could not reach the server. Check your connection and try again.'
        : describeStitchConnectError(outcome),
    );
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="stitch-api-key" className="text-on-surface text-sm font-medium">
        {reconnect ? 'Replace Stitch API key' : 'Stitch API key'}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="stitch-api-key"
          ref={inputRef}
          type="password"
          name="stitch-api-key"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby="stitch-api-key-help"
          className={INPUT_CLASSNAME}
        />
        <button
          type="submit"
          disabled={pending}
          className={`${PRIMARY_LINK} disabled:opacity-60 sm:shrink-0`}
        >
          {pending ? 'Checking…' : reconnect ? 'Reconnect Stitch' : 'Connect Stitch'}
        </button>
      </div>
      <p id="stitch-api-key-help" className="text-secondary text-xs">
        The key is checked with Stitch, stored encrypted, and never shown again.
      </p>
      {error && (
        <p role="alert" className="text-error flex items-start gap-1.5 text-xs">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </form>
  );
}

function DisconnectDialog({
  provider,
  onClose,
  onDone,
}: {
  provider: ConnectionProvider;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const router = useRouter();
  const label = PROVIDER_LABEL[provider];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!pending) onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pending]);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/connections/${provider}`, { method: 'DELETE' });
      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }
      // 404 = nothing connected any more (another tab): the wanted outcome.
      if (response.status === 404) {
        await onDone(`${label} was already disconnected.`);
        return;
      }
      if (!response.ok) {
        setError('Could not disconnect. Please try again.');
        setPending(false);
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        providerRevoked?: boolean | null;
      } | null;
      await onDone(describeDisconnectResult(provider, body?.providerRevoked ?? null));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <div
      className="bg-inverse-surface/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="disconnect-title"
        aria-describedby="disconnect-description"
        className="bg-surface-container-lowest border-surface-dim w-full max-w-md rounded-xl border p-6 shadow-lg"
      >
        <h2
          id="disconnect-title"
          className="text-on-surface flex items-center gap-2 text-lg font-semibold"
        >
          <Link2 className="size-5" aria-hidden="true" />
          Disconnect {label}?
        </h2>
        <p
          id="disconnect-description"
          className="text-on-surface-variant mt-2 text-sm leading-relaxed"
        >
          Throughline will stop using your {label} account and, where {label} allows it, revoke its
          access. Anything already created there is left untouched, and earlier exports will ask you
          to reconnect before they can continue.
        </p>
        {error && (
          <p
            role="alert"
            className="bg-error-container text-on-error-container mt-3 rounded-lg p-3 text-sm"
          >
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className="bg-error text-on-error hover:bg-error/90 focus-visible:ring-error flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}
