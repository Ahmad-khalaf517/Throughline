import type { ReactNode } from 'react';
import Link from 'next/link';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-surface flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">{children}</div>
      <p className="text-on-surface-variant mt-6 text-xs">
        <Link
          href="/privacy"
          className="hover:text-on-surface focus-visible:ring-primary rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          Privacy
        </Link>
      </p>
    </main>
  );
}
