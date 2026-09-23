'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormMessage } from '@/components/auth/form-message';
import { SubmitButton } from '@/components/auth/submit-button';
import { TextField } from '@/components/auth/text-field';
import { forgotPasswordAction, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = { status: 'idle', message: null };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const searchParams = useSearchParams();
  const linkFailed = searchParams.get('error') === 'link_failed';

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email. If it matches an account, we'll send a link to reset your password."
      badge="SEC-AUTH"
      footer={
        <Link
          href="/sign-in"
          className="text-secondary hover:text-on-surface inline-flex items-center gap-1.5 font-medium transition-colors"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      }
    >
      {linkFailed && (
        <div className="mb-4">
          <FormMessage variant="error">
            That reset link is invalid or expired. Request a new one below.
          </FormMessage>
        </div>
      )}

      {state.status === 'success' ? (
        <FormMessage variant="success">{state.message}</FormMessage>
      ) : (
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <TextField
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            placeholder="name@work-email.com"
          />

          {state.status === 'error' && <FormMessage variant="error">{state.message}</FormMessage>}

          <SubmitButton pending={pending} label="Send reset link" pendingLabel="Sending…" />
        </form>
      )}
    </AuthCard>
  );
}
