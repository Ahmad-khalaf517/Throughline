import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listProjectsForOwner } from '@/artifact-lifecycle';
import { getVerifiedUser } from '@/auth';
import { NewProjectForm } from './new-project-form';

/**
 * First authenticated app screen (E5-S1). Reads go straight through
 * `artifact-lifecycle`/`auth` from this Server Component - same pattern
 * `sign-up/page.tsx` already uses for `getVerifiedUser()` - rather than the
 * page self-fetching its own `GET /api/projects` route.
 */
export default async function ProjectsPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const projects = await listProjectsForOwner(user.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-on-surface text-display-sm font-semibold">Projects</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          Everything you&apos;re tracing lineage for, in one place.
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="text-on-surface-variant bg-surface-container-lowest border-surface-dim rounded-xl border p-6 text-sm">
          No projects yet. Create your first one below to get started.
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

      <NewProjectForm />
    </main>
  );
}
