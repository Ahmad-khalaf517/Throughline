import Link from 'next/link';
import { LogoMark } from '@/components/icons/logo-mark';

interface FooterProps {
  userEmail: string | null;
}

/**
 * Presentational only (Module Boundaries: `components` may import `lib`
 * only). Auth state is resolved in `app` and passed down as a prop -
 * mirrors Navbar.
 */
export function Footer({ userEmail }: FooterProps) {
  return (
    <footer className="bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link
          href="/"
          className="focus-visible:ring-primary flex items-center gap-2.5 rounded-md opacity-80 focus-visible:ring-2 focus-visible:outline-none"
        >
          <LogoMark />
        </Link>
        <div className="text-on-surface-variant flex items-center gap-5 text-xs">
          {!userEmail && (
            <>
              <Link
                href="/sign-in"
                className="hover:text-on-surface focus-visible:ring-primary rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="hover:text-on-surface focus-visible:ring-primary rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                Sign up
              </Link>
            </>
          )}
          <span className="font-mono-code text-on-surface-variant">
            &copy; {new Date().getFullYear()} Throughline
          </span>
        </div>
      </div>
    </footer>
  );
}
