import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getImpactWarningsResolved, getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { WarningPanel } from '@/components/review/warning-panel';

interface ProjectWarningsPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The warning panel route (E5-S6). Auth guard / `notFound()` mapping copied
 * from `artifacts/[type]/page.tsx` exactly (see that file's own comment for
 * why `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly).
 *
 * Reads real data via `artifact-lifecycle.getImpactWarningsResolved`
 * (SCRUM-86) - the same "read directly, write through api" convention
 * `getProjectById` below already uses (Module Boundaries 4.8).
 */
export default async function ProjectWarningsPage({ params }: ProjectWarningsPageProps) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const { projectId } = await params;

  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }

  const project = await getProjectById(projectId);
  if (!project) notFound();

  const warnings = await getImpactWarningsResolved(projectId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary w-fit rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        ← {project.name}
      </Link>

      <header className="border-surface-dim bg-surface-container-lowest rounded-lg border px-5 py-5 sm:px-6">
        <p className="font-mono-code text-on-surface-variant text-[10px] font-medium tracking-wide uppercase">
          Lineage / Impact review
        </p>
        <h1 className="text-on-surface text-display-sm mt-1 font-semibold">Impact warnings</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          Trace potentially affected items from the upstream source to each downstream dependency.
        </p>
      </header>

      <WarningPanel warnings={warnings} />
    </main>
  );
}
