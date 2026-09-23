'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthShell } from '@/components/auth/auth-shell';
import { FormMessage } from '@/components/auth/form-message';
import { PasswordField } from '@/components/auth/password-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { resetPasswordAction, type ResetPasswordState } from './actions';

const initialState: ResetPasswordState = { status: 'idle', message: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <AuthShell>
      <AuthCard
        title="Set a new password"
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
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <PasswordField
            id="password"
            name="password"
            label="New password"
            autoComplete="new-password"
            required
            minLength={8}
            helperText="At least 8 characters."
            onChange={setPassword}
          />

          <PasswordField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            required
            minLength={8}
            errorText={mismatch ? 'Passwords do not match.' : undefined}
            onChange={setConfirmPassword}
          />

          {state.status === 'error' && <FormMessage variant="error">{state.message}</FormMessage>}

          <SubmitButton pending={pending} label="Update password" pendingLabel="Updating…" />
        </form>
      </AuthCard>
    </AuthShell>
  );
}
