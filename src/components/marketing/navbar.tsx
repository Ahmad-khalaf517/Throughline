import Link from 'next/link';
import { LogoMark } from '@/components/icons/logo-mark';

const NAV_LINKS = [
  { href: '#workflow', label: 'Workflow' },
  { href: '#lineage', label: 'Lineage' },
  { href: '#approval', label: 'Approval' },
  { href: '#integrations', label: 'Integrations' },
];

interface NavbarProps {
  userEmail: string | null;
  onSignOut: () => Promise<void>;
}

/**
 * Presentational only (Module Boundaries: `components` may import `lib`
 * only). Auth state is resolved in `app` and passed down as props.
 */
export function Navbar({ userEmail, onSignOut }: NavbarProps) {
  return (
    <header className="border-surface-dim bg-surface-container-lowest/90 sticky top-0 z-40 w-full border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
        </Link>

        <nav className="text-on-surface-variant hidden items-center gap-1 text-[13px] font-medium md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hover:bg-surface-container-low hover:text-on-surface focus-visible:ring-primary rounded-md px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {userEmail ? (
            <>
              <Link
                href="/projects"
                className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-md text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                Projects
              </Link>
              <span className="text-on-surface-variant hidden text-xs sm:inline">
                Signed in as <span className="text-on-surface font-medium">{userEmail}</span>
              </span>
              <form action={onSignOut}>
                <button
                  type="submit"
                  className="border-surface-dim text-on-surface hover:bg-surface-container-low focus-visible:ring-primary rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary hidden rounded-md text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none sm:inline"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary rounded-md px-3.5 py-1.5 text-[13px] font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Start a project
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
