'use client';

import { useActionState } from 'react';
import { resetPasswordAction, type ResetPasswordState } from './actions';

const initialState: ResetPasswordState = { status: 'idle', message: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Set a new password</h1>

        <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="rounded border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
            />
            <span className="text-xs text-neutral-500">At least 8 characters.</span>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="rounded border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
            />
          </div>

          {state.status === 'error' && (
            <p role="alert" className="text-sm text-red-600">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      </div>
    </main>
  );
}
