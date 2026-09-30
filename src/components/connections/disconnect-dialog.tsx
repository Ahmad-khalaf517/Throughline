'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
 * screens. Rendering and keyboard handling live in the shared `ConfirmDialog`.
 */
export function DisconnectDialog({ provider, onClose, onDone }: DisconnectDialogProps) {
  const router = useRouter();
  const label = PROVIDER_LABEL[provider];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <ConfirmDialog
      idPrefix="disconnect"
      title={`Disconnect ${label}?`}
      icon={Link2}
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting…"
      pending={pending}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <p>
        Throughline will stop using your {label} account and, where {label} allows it, revoke its
        access. Anything already created there is left untouched, and earlier exports will ask you
        to reconnect before they can continue.
      </p>
    </ConfirmDialog>
  );
}
