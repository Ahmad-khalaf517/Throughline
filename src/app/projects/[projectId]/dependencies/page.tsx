import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getImpactWarningsResolved, getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { DependencyGraph } from '@/components/review/dependency-graph';
import { loadReviewVersion } from '../artifacts/load-review-version';

interface ProjectDependenciesPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The dependency/version visualization route (E5-S7, TR section 27: "a
 * simple dependency/version view... a demo and comprehension feature, not a
 * graph-editing product"). Auth guard / `notFound()` mapping copied from
 * `warnings/page.tsx` exactly (see that file's own comment for why
 * `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly).
 *
 * Reads real data: the same `getImpactWarningsResolved` the warning panel
 * reads, plus the Requirements version (`loadReviewVersion`, shared with
 * `artifacts/[type]/page.tsx` so the two never duplicate the version/impact/
 * quality-issue composition) - TR section 27's own requirement that the
 * visualization "must use the same dependency data and traversal rules as
 * the warning engine," never an independent implementation. `loadReviewVersion`
 * returning `null` (no Requirements version generated yet) is the same
 * graceful "coming soon" treatment `artifacts/[type]/page.tsx` uses, not a
 * 404.
 */
export default async function ProjectDependenciesPage({ params }: ProjectDependenciesPageProps) {
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

  const reviewData = await loadReviewVersion(projectId, 'requirements');
  const warnings = await getImpactWarningsResolved(projectId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← {project.name}
      </Link>

      <header className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h1 className="text-on-surface text-display-sm font-semibold">Dependencies</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          How this project&apos;s versions and items connect, and what a recent change reaches.
        </p>
      </header>

      {reviewData ? (
        <DependencyGraph version={reviewData.version} warnings={warnings} />
      ) : (
        <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-8 text-center">
          <p className="text-on-surface text-sm font-medium">
            The dependency view isn&apos;t available yet.
          </p>
          <p className="text-on-surface-variant mt-1 text-sm">
            This project doesn&apos;t have version data to visualize yet - it&apos;s coming soon,
            not broken.
          </p>
        </div>
      )}
    </main>
  );
}
