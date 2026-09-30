'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Header text link to the project list; marks itself current anywhere under `/projects`. */
export function ProjectsNavLink() {
  const pathname = usePathname();
  const active = pathname === '/projects' || pathname.startsWith('/projects/');

  return (
    <Link
      href="/projects"
      aria-current={active ? 'page' : undefined}
      className={`hover:text-primary focus-visible:ring-primary hidden rounded-md text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none sm:inline ${
        active ? 'text-on-surface underline underline-offset-4' : 'text-on-surface-variant'
      }`}
    >
      Projects
    </Link>
  );
}
