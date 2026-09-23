'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { signInAction, type SignInState } from './actions';

const initialState: SignInState = { status: 'idle', message: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const searchParams = useSearchParams();
  const verificationFailed = searchParams.get('error') === 'verification_failed';

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold">Sign in</h1>

      {verificationFailed && (
        <p role="alert" className="mt-4 rounded border border-red-300 p-3 text-sm text-red-600">
          That verification link is invalid or expired. Sign up again to get a new one.
        </p>
      )}

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

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-neutral-500 underline underline-offset-2"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
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
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-neutral-500">
        Don&apos;t have an account?{' '}
        <Link href="/sign-up" className="underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </div>
  );
}
