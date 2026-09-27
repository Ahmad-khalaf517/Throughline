import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectItemVersionDetail } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';

export default async function ProjectItemVersionPage({
  params,
}: PageProps<'/projects/[projectId]/items/[itemVersionId]'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');
  const { projectId, itemVersionId } = await params;
  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const item = await getProjectItemVersionDetail(projectId, itemVersionId);
  if (!item) notFound();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-primary-container focus-visible:ring-primary w-fit rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        ← Project overview
      </Link>
      <article className="bg-surface-container-lowest border-surface-dim rounded-lg border p-6">
        <p className="text-on-surface-variant text-xs tracking-wide uppercase">
          Stored item version
        </p>
        <h1 className="text-on-surface font-mono-code mt-2 text-2xl font-semibold">
          {item.displayKey}
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm">
          {item.itemType.replace('_', ' ')} · revision {item.revisionNumber}
        </p>
        <p className="text-on-surface-variant mt-1 text-xs">
          Created{' '}
          <time dateTime={item.createdAt.toISOString()}>{item.createdAt.toISOString()}</time>
        </p>
        <pre className="bg-surface-container-low text-on-surface mt-6 overflow-x-auto rounded-md p-4 text-xs whitespace-pre-wrap">
          {JSON.stringify(item.payload, null, 2)}
        </pre>
      </article>
    </main>
  );
}
