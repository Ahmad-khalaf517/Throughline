'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PROJECT_SECTIONS } from './project-navigation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ProjectSidebar() {
  const pathname = usePathname();
  const segment = pathname.split('/')[2];
  const projectId = segment && UUID_RE.test(segment) ? segment : null;
  const basePath = projectId ? `/projects/${projectId}` : null;

  return (
    <aside className="border-surface-dim bg-surface hidden h-[calc(100vh-40px)] w-[260px] shrink-0 self-start overflow-y-auto border-r px-4 py-6 lg:sticky lg:top-10 lg:block">
      <nav aria-label="Workspace navigation" className="flex flex-col gap-6">
        <div>
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
              Workspace
            </p>
            <span className="text-on-surface-variant text-xs">Personal</span>
          </div>
          <Link
            href="/projects"
            aria-current={pathname === '/projects' ? 'page' : undefined}
            className={`focus-visible:ring-primary flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none ${
              pathname === '/projects'
                ? 'border-surface-dim bg-surface-container-lowest text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface border-transparent'
            }`}
          >
            <span>All Projects</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        {basePath ? (
          <div>
            <p className="text-on-surface-variant mb-2 px-2 text-xs font-semibold tracking-wide uppercase">
              Current project
            </p>
            <div className="flex flex-col gap-1">
              {PROJECT_SECTIONS.map((link) => {
                const href = `${basePath}${link.path}`;
                const active =
                  link.path === ''
                    ? pathname === href
                    : pathname === href || pathname.startsWith(`${href}/`);

                return (
                  <Link
                    key={link.label}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`focus-visible:ring-primary rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none ${
                      active
                        ? 'border-surface-dim bg-surface-container-lowest text-on-surface font-semibold'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface border-transparent font-medium'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-on-surface-variant px-2 text-sm">
            Open a project to see its sections.
          </p>
        )}
      </nav>
    </aside>
  );
}
