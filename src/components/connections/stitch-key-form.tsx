'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import { describeStitchConnectError } from '@/lib/connections-ui';

interface ErrorBody {
  error?: { code?: string };
}

const PRIMARY_BUTTON =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex h-10 items-center justify-center rounded-lg px-3 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:shrink-0';
const INPUT_CLASSNAME =
  'border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:ring-primary h-10 w-full rounded-lg border px-3.5 text-sm transition-colors focus:ring-1 focus:outline-none';

interface StitchKeyFormProps {
  /** A key is already stored (lapsed): the copy says replace/reconnect. */
  reconnect: boolean;
  /** Called after the key was accepted and stored. */
  onSaved: () => Promise<void> | void;
}

/**
 * The only place a provider secret is typed. The key lives in an uncontrolled
 * password input: it is read from the form once on submit and the field is
 * cleared straight away - success or failure - so it is never held in React
 * state, never logged, and never shown again (not even masked). Used on the
 * Integrations screen and inline in the Stitch screen's guided steps.
 */
export function StitchKeyForm({ reconnect, onSaved }: StitchKeyFormProps) {
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
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
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
