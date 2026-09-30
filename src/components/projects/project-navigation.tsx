'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  GitFork,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Monitor,
  TriangleAlert,
  Upload,
} from 'lucide-react';

export const PROJECT_SECTIONS = [
  { label: 'Overview', path: '', icon: LayoutDashboard },
  { label: 'Requirements', path: '/artifacts/requirements', icon: ListChecks },
  { label: 'Architecture', path: '/artifacts/architecture', icon: Boxes },
  { label: 'UI Requirements', path: '/artifacts/ui_requirements', icon: Monitor },
  { label: 'Backlog', path: '/artifacts/backlog', icon: ListTodo },
  { label: 'BRD', path: '/artifacts/brd', icon: ListChecks },
  { label: 'ERD', path: '/artifacts/erd', icon: Boxes },
  { label: 'Warnings', path: '/warnings', icon: TriangleAlert },
  { label: 'Dependencies', path: '/dependencies', icon: GitFork },
  { label: 'Outputs', path: '/outputs', icon: Upload },
] as const;

export function ProjectNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const basePath = `/projects/${projectId}`;

  return (
    <nav aria-label="Project sections" className="overflow-x-auto lg:hidden">
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
              className={`focus-visible:ring-primary rounded-t-md border-b-2 px-3 py-3 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none sm:text-sm ${
                active
                  ? 'border-primary-container text-primary bg-surface-container-low'
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
