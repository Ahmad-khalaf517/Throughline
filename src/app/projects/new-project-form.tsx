'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormMessage } from '@/components/auth/form-message';
import { SubmitButton } from '@/components/auth/submit-button';
import { TextField } from '@/components/auth/text-field';
import { TextAreaField } from '@/components/projects/text-area-field';

/**
 * The one mutation in this story. Calls `POST /api/projects` directly from
 * the browser rather than a Server Action, reusing that route's own
 * already-validated/tested Zod schema (API Contracts section 3) instead of
 * re-implementing validation here (E5-S1 architecture decision).
 */
export function NewProjectForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') ?? '').trim();
    const brief = String(formData.get('brief') ?? '').trim();

    // `noValidate` (below) disables the browser's own `required` checks, so
    // this is the only thing stopping an empty submit from round-tripping to
    // the API just to get back its generic 'Invalid request body.' message.
    if (!name || !brief) {
      setError('Project name and brief are required.');
      setPending(false);
      return;
    }

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, brief }),
      });

      if (response.status === 401) {
        // Session expired between page load and submit - send the user to
        // sign back in rather than leaving an inline error they can't act on.
        router.push('/sign-in');
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error?.message ?? 'Something went wrong. Please try again.');
        setPending(false);
        return;
      }

      // 201 -> ProjectDTO (API Contracts section 3). Full navigation keeps
      // this simple; the detail page re-reads the project server-side.
      router.push(`/projects/${body.id}`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <div className="bg-surface-container-lowest border-surface-dim rounded-xl border p-6">
      <h2 className="text-on-surface text-lg font-semibold">New project</h2>
      <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">
        Give it a name and a brief describing what you&apos;re building. You can keep refining the
        brief until Requirements generation starts.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <TextField
          id="name"
          name="name"
          label="Project name"
          required
          placeholder="Acme Checkout Revamp"
        />

        <TextAreaField
          id="brief"
          name="brief"
          label="Brief"
          required
          rows={6}
          placeholder="Describe the problem, the users, and what success looks like..."
        />

        {error && <FormMessage variant="error">{error}</FormMessage>}

        <SubmitButton pending={pending} label="Create project" pendingLabel="Creating project…" />
      </form>
    </div>
  );
}
