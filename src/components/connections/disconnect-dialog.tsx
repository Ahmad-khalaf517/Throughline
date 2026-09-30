'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Link2, Loader2 } from 'lucide-react';
import {
  describeDisconnectResult,
  PROVIDER_LABEL,
  type ConnectionProvider,
} from '@/lib/connections-ui';

interface DisconnectDialogProps {
  provider: ConnectionProvider;
  onClose: () => void;
  /** Called after a successful (or already-gone) disconnect with the result copy to show. */
  onDone: (message: string) => Promise<void> | void;
}

/**
 * The confirm dialog for `DELETE /api/connections/:provider`, shared by the
 * Integrations screen and the guided steps on the GitHub / Jira / Stitch
 * screens. Rendered in a portal; focus starts on Cancel (the safe choice), Tab
 * is trapped inside, Escape and a click outside cancel, and focus returns to the
 * control that opened it (when it still exists) on close.
 */
export function DisconnectDialog({ provider, onClose, onDone }: DisconnectDialogProps) {
  const router = useRouter();
  const label = PROVIDER_LABEL[provider];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
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

  return createPortal(
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
    </div>,
    document.body,
  );
}
