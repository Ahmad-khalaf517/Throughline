import Link from 'next/link';
import { redirect } from 'next/navigation';
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-on-surface text-display-sm font-semibold">Projects</h1>
          <p className="text-on-surface-variant mt-1 text-sm">
            Everything you&apos;re tracing lineage for, in one place.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-10 shrink-0 items-center rounded-lg px-4 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-on-surface-variant bg-surface-container-lowest border-surface-dim rounded-xl border p-6 text-sm">
          No projects yet. Use the &ldquo;New project&rdquo; button above to create your first one.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="bg-surface-container-lowest border-surface-dim hover:border-outline focus-visible:ring-primary block rounded-xl border p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <h2 className="text-on-surface text-base font-semibold">{project.name}</h2>
                <p className="text-on-surface-variant mt-1 line-clamp-2 text-sm">{project.brief}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
