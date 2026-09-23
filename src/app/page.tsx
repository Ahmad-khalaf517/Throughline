import Link from 'next/link';
import { getVerifiedUser } from '@/auth';
import { signOutAction } from './actions';

export default async function Home() {
  const user = await getVerifiedUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Throughline</h1>

      {user ? (
        <div className="flex flex-col items-center gap-2 text-sm">
          <p>
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <div className="flex gap-3 text-sm">
          <Link href="/sign-in" className="underline underline-offset-2">
            Sign in
          </Link>
          <Link href="/sign-up" className="underline underline-offset-2">
            Sign up
          </Link>
        </div>
      )}

      <p className="text-sm text-neutral-500">Slice 1 scaffold - project screens not built yet.</p>
    </main>
  );
}
