'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormMessage } from '@/components/auth/form-message';
import { PasswordField } from '@/components/auth/password-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { TextField } from '@/components/auth/text-field';
import { signInAction, type SignInState } from './actions';

const initialState: SignInState = { status: 'idle', message: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const searchParams = useSearchParams();
  const verificationFailed = searchParams.get('error') === 'verification_failed';

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New here?{' '}
          <Link href="/sign-up" className="text-primary font-medium hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {verificationFailed && (
        <div className="mb-4">
          <FormMessage variant="error">
            That verification link is invalid or expired. Sign up again to get a new one.
          </FormMessage>
        </div>
      )}

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

        <PasswordField
          id="password"
          name="password"
          label="Password"
          autoComplete="current-password"
          required
          labelAddon={
            <Link
              href="/forgot-password"
              className="text-primary text-xs font-medium hover:underline"
            >
              Forgot password?
            </Link>
          }
        />

        {state.status === 'error' && <FormMessage variant="error">{state.message}</FormMessage>}

        <SubmitButton pending={pending} label="Sign in" pendingLabel="Signing in…" />
      </form>
    </AuthCard>
  );
}
