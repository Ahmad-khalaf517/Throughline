'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signUpAction, type SignUpState } from './actions';

const initialState: SignUpState = { status: 'idle', message: null };

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Create an account</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Anyone can sign up. You&apos;ll need to verify your email before signing in.
        </p>

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

            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-sm font-medium">
                Password
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
              {pending ? 'Creating account…' : 'Sign up'}
            </button>
          </form>
        )}

        <p className="mt-6 text-sm text-neutral-500">
          Already have an account?{' '}
          <Link href="/sign-in" className="underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
