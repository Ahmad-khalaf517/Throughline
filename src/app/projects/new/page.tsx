import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/auth';
import { NewProjectForm } from '../new-project-form';

/**
 * The project-creation screen, split out of `/projects` (SCRUM-86) so that
 * page is a plain list rather than a list-plus-form hybrid. Same auth guard
 * pattern every other page here uses. `NewProjectForm` itself needs no
 * changes - it already redirects to `/projects/${body.id}` on success, which
 * works from either page it's rendered on.
 */
export default async function NewProjectPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href="/projects"
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary w-fit rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        ← Projects
      </Link>

      <h1 className="text-on-surface text-display-sm font-semibold">New project</h1>

      <NewProjectForm />
    </main>
  );
}
