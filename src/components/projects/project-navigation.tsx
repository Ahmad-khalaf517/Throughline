'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const PROJECT_SECTIONS = [
  { label: 'Overview', path: '' },
  { label: 'Requirements', path: '/artifacts/requirements' },
  { label: 'Architecture', path: '/artifacts/architecture' },
  { label: 'UI Requirements', path: '/artifacts/ui_requirements' },
  { label: 'Backlog', path: '/artifacts/backlog' },
  { label: 'Warnings', path: '/warnings' },
  { label: 'Dependencies', path: '/dependencies' },
  { label: 'Outputs', path: '/outputs' },
] as const;

export function ProjectNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const basePath = `/projects/${projectId}`;

  return (
    <nav aria-label="Project sections" className="overflow-x-auto">
      <div className="flex min-w-max items-center gap-2">
        {PROJECT_SECTIONS.map((section) => {
          const href = `${basePath}${section.path}`;
          const active =
            section.path === ''
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={section.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`focus-visible:ring-primary rounded-t-md border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none ${
                active
                  ? 'border-primary-container text-on-surface bg-surface-container-low'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border-transparent'
              }`}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
