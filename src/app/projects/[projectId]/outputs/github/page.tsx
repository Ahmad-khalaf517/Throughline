import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { GithubInitPanel } from '@/components/external/github-init-panel';

interface ProjectGithubOutputPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * `POST /api/projects/:projectId/github/{preview,init}` screen (E5-S9, API
 * Contracts section 8). Auth guard / `notFound()` mapping copied from
 * `warnings/page.tsx` exactly - all the real data fetching and the write
 * itself happen client-side in `GithubInitPanel` (Module Boundaries 4.8:
 * "every mutation still goes through its documented `api` route").
 */
export default async function ProjectGithubOutputPage({ params }: ProjectGithubOutputPageProps) {
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href={`/projects/${projectId}/outputs`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← Outputs
      </Link>

      <header className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h1 className="text-on-surface text-display-sm font-semibold">GitHub</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          Initialize a repository from {project.name}&apos;s approved Architecture.
        </p>
      </header>

      <GithubInitPanel projectId={projectId} />
    </main>
  );
}
