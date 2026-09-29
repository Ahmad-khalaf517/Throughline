import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, FolderKanban, Plus } from 'lucide-react';
import { listProjectsForOwner } from '@/artifact-lifecycle';
import { getVerifiedUser } from '@/auth';

/**
 * First authenticated app screen (E5-S1). Reads go straight through
 * `artifact-lifecycle`/`auth` from this Server Component - same pattern
 * `sign-up/page.tsx` already uses for `getVerifiedUser()` - rather than the
 * page self-fetching its own `GET /api/projects` route.
 *
 * List-only (SCRUM-86): creation moved to its own route (`/projects/new`,
 * `new/page.tsx`) so this screen isn't a form-plus-list hybrid - the header's
 * "New project" button is the one way in from here.
 */
export default async function ProjectsPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const projects = await listProjectsForOwner(user.id);

  return (
    <main className="flex min-h-screen w-full flex-col gap-9 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="app-kicker">Your workspace</p>
          <h1 className="app-display text-on-surface mt-2 text-[clamp(2.5rem,5vw,4rem)] leading-tight">
            All projects<span className="text-primary">.</span>
          </h1>
          <p className="text-on-surface-variant mt-2 max-w-lg text-sm leading-relaxed">
            Pick up the thread of a project, or start a new plan from a brief.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Plus className="size-4" aria-hidden="true" />
          New project
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="app-card flex max-w-2xl flex-col items-start p-8 sm:p-12">
          <span className="app-accent-soft flex size-11 items-center justify-center rounded-xl">
            <FolderKanban className="size-5" aria-hidden="true" />
          </span>
          <h2 className="app-display text-on-surface mt-5 text-2xl">
            Your first project starts here.
          </h2>
          <p className="text-on-surface-variant mt-2 max-w-md text-sm leading-relaxed">
            Bring a brief. Throughline will help you turn it into a connected plan, one approval at
            a time.
          </p>
          <Link
            href="/projects/new"
            className="text-primary hover:text-primary-container-hover focus-visible:ring-primary mt-5 inline-flex items-center gap-2 rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Create a project <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <section aria-label="Your projects">
          <div className="border-surface-dim text-on-surface-variant mb-4 flex items-center justify-between border-b pb-3 text-xs">
            <span>
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </span>
            <span>Open a project to continue</span>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="app-card app-card-link group flex min-h-48 flex-col p-5 focus-visible:outline-none sm:p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span
                      className="app-accent-soft flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                      aria-hidden="true"
                    >
                      {project.name.trim().charAt(0).toUpperCase() || 'P'}
                    </span>
                    <ArrowUpRight
                      className="text-on-surface-variant group-hover:text-primary size-4 transition-colors"
                      aria-hidden="true"
                    />
                  </div>
                  <h2 className="text-on-surface mt-5 text-lg font-semibold tracking-tight">
                    {project.name}
                  </h2>
                  <p className="text-on-surface-variant mt-1 line-clamp-2 text-sm leading-relaxed">
                    {project.brief}
                  </p>
                  <span className="text-primary mt-auto pt-5 text-xs font-semibold">
                    Open workspace
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
