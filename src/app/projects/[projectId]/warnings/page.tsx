import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { WarningPanel } from '@/components/review/warning-panel';
import { getFixtureImpactWarnings } from '@/components/review/fixtures';

interface ProjectWarningsPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The warning panel route (E5-S6). Auth guard / `notFound()` mapping copied
 * from `artifacts/[type]/page.tsx` exactly (see that file's own comment for
 * why `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly).
 *
 * E3-S11 (the impact routes) doesn't exist yet, so this page reads fixture
 * data via `getFixtureImpactWarnings` instead of the real
 * `GET /api/projects/:projectId/impact` - see that function's header
 * comment for the swap point. `getProjectById` is still a real read
 * (E1-S8), used here only for the project name shown above the panel.
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

  const warnings = getFixtureImpactWarnings(projectId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← {project.name}
      </Link>

      <header className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h1 className="text-on-surface text-display-sm font-semibold">Warnings</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          Items potentially affected by an upstream change, across this project.
        </p>
      </header>

      <WarningPanel warnings={warnings} />
    </main>
  );
}
