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
    <aside className="border-surface-dim bg-surface hidden h-[calc(100vh-64px)] w-[232px] shrink-0 self-start overflow-y-auto border-r px-3 py-7 lg:sticky lg:top-16 lg:block">
      <nav aria-label="Workspace navigation" className="flex flex-col gap-8">
        <div>
          <div className="mb-3 flex items-center justify-between px-3">
            <p className="app-kicker">Workspace</p>
          </div>
          <Link
            href="/projects"
            aria-current={pathname === '/projects' ? 'page' : undefined}
            className={`focus-visible:ring-primary flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none ${
              pathname === '/projects'
                ? 'app-rail-active'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
            }`}
          >
            <span>All Projects</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        {basePath ? (
          <div>
            <p className="app-kicker mb-3 px-3">Current project</p>
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
                    className={`focus-visible:ring-primary flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                      active
                        ? 'app-rail-active font-semibold'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface font-medium'
                    }`}
                  >
                    <link.icon className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
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
