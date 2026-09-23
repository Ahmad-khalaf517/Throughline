'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthShell } from '@/components/auth/auth-shell';
import { FormMessage } from '@/components/auth/form-message';
import { PasswordField } from '@/components/auth/password-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { TextField } from '@/components/auth/text-field';
import { signUpAction, type SignUpState } from './actions';

const initialState: SignUpState = { status: 'idle', message: null };

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <AuthShell>
      <AuthCard
        title="Create your account"
        description="You'll confirm your email before you can sign in."
        footer={
          <>
            Already have an account?{' '}
            <Link href="/sign-in" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </>
        }
      >
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

            <PasswordField
              id="password"
              name="password"
              label="Password"
              autoComplete="new-password"
              required
              minLength={8}
              helperText="At least 8 characters."
            />

            {state.status === 'error' && <FormMessage variant="error">{state.message}</FormMessage>}

            <SubmitButton
              pending={pending}
              label="Create account"
              pendingLabel="Creating account…"
            />
          </form>
        )}
      </AuthCard>
    </AuthShell>
  );
}
