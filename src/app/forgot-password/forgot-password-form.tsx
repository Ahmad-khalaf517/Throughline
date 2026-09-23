'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { forgotPasswordAction, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = { status: 'idle', message: null };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const searchParams = useSearchParams();
  const linkFailed = searchParams.get('error') === 'link_failed';

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      {linkFailed && (
        <p role="alert" className="mt-4 rounded border border-red-300 p-3 text-sm text-red-600">
          That reset link is invalid or expired. Request a new one below.
        </p>
      )}

      {state.status === 'success' ? (
        <p role="status" className="mt-6 rounded border border-neutral-300 p-3 text-sm">
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
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
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="mt-6 text-sm text-neutral-500">
        <Link href="/sign-in" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
