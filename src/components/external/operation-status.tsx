'use client';

import { useEffect, useState } from 'react';
import type { ExternalOperationDTO } from '@/lib/serialize';
import { describeOperationStatus } from '@/lib/external-preview';

interface OperationStatusProps {
  operationId: string;
}

const POLL_INTERVAL_MS = 3000;

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Polls `GET /api/external-operations/:operationId` (API Contracts section
 * 7) - the target for an operation left `pending`/`reconciliation_required`
 * after its initiating call returned a `202`. Stops polling (clearing the
 * timer) once the operation reaches a terminal status (`completed` /
 * `failed`) or this component unmounts - it never polls forever.
 *
 * When `describeOperationStatus` reports `retryable`, offers a
 * user-initiated `POST .../retry` (ERD 7.2 - never automatic). That route's
 * own header comment names a known contract gap: a retry of a
 * definitively-`failed` operation has no documented response shape and
 * falls through to a `500`. Rather than let that read as a crash, a
 * non-2xx retry response is surfaced here as "retry didn't complete" - the
 * durable operation row is still there and still visible via the next poll.
 */
export function OperationStatus({ operationId }: OperationStatusProps) {
  const [operation, setOperation] = useState<ExternalOperationDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/external-operations/${operationId}`);
        const body = (await response.json().catch(() => null)) as
          ExternalOperationDTO | ErrorBody | null;
        if (cancelled) return;

        if (!response.ok) {
          setLoadError(
            (body as ErrorBody | null)?.error?.message ?? 'Could not load this operation.',
          );
          return;
        }

        const op = body as ExternalOperationDTO;
        setLoadError(null);
        setOperation(op);
        if (op.status === 'pending' || op.status === 'reconciliation_required') {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          setLoadError('Could not reach the server. Check your connection.');
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `refreshToken` deliberately re-runs this effect on demand (see
    // `handleRetry` below) - a manual poll trigger, not a data dependency.
  }, [operationId, refreshToken]);

  async function handleRetry() {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const response = await fetch(`/api/external-operations/${operationId}/retry`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setRetryMessage(
          body?.error?.message ??
            "Retry didn't complete. The operation record is still available - try again shortly.",
        );
      }
    } catch {
      setRetryMessage('Could not reach the server. Check your connection.');
    } finally {
      setRetrying(false);
      // Re-poll either way, so a successful retry's new status (or a failed
      // retry's unchanged one) shows up without a manual refresh.
      setRefreshToken((token) => token + 1);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="bg-error-container text-on-error-container rounded-lg p-3 text-sm">
        {loadError}
      </p>
    );
  }

  if (!operation) {
    return <p className="text-on-surface-variant text-sm">Loading operation status…</p>;
  }

  const copy = describeOperationStatus(operation.status);

  return (
    <div className="border-surface-dim bg-surface-container-low flex flex-col gap-2 rounded-xl border p-4">
      <p className="text-on-surface text-sm font-medium">{copy.label}</p>
      <p className="text-on-surface-variant text-sm leading-relaxed">{copy.detail}</p>
      {operation.errorMessage && (
        <p className="text-on-surface-variant text-xs">{operation.errorMessage}</p>
      )}
      {copy.retryable && (
        <div>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="border-outline-variant text-on-surface hover:bg-surface-container focus-visible:ring-primary rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
          {retryMessage && <p className="text-on-surface-variant mt-1 text-xs">{retryMessage}</p>}
        </div>
      )}
    </div>
  );
}
