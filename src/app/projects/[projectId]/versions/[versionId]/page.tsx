import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getArtifactVersionDetail, getCurrentItemImpactCauses } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { FlaggedGlyph, StatusBadge } from '@/components/status/status-badge';
import { ApiError } from '@/lib/errors';

export default async function ProjectVersionPage({
  params,
}: PageProps<'/projects/[projectId]/versions/[versionId]'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');
  const { projectId, versionId } = await params;
  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const detail = await getArtifactVersionDetail(versionId);
  if (!detail || detail.version.projectId !== projectId) notFound();
  const causes = await getCurrentItemImpactCauses(
    projectId,
    detail.items.map((item) => item.itemVersionId),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-primary-container focus-visible:ring-primary w-fit rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        ← Project overview
      </Link>
      <header className="bg-surface-container-lowest border-surface-dim rounded-lg border p-6">
        <p className="text-on-surface-variant text-xs tracking-wide uppercase">
          {detail.version.artifactType.replace('_', ' ')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-on-surface text-2xl font-semibold">
            Version {detail.version.versionNumber}
          </h1>
          <StatusBadge status={detail.version.status} />
        </div>
        <p className="text-on-surface-variant mt-2 text-xs">
          {detail.items.length} {detail.items.length === 1 ? 'item' : 'items'} in this version
        </p>
      </header>
      {(detail.version.artifactType === 'brd' || detail.version.artifactType === 'erd') && (
        <section
          className="bg-surface-container-lowest border-surface-dim rounded-lg border p-6"
          aria-label="Document payload"
        >
          <h2 className="text-on-surface mb-3 text-base font-semibold">Document content</h2>
          <pre className="bg-surface-container-low text-on-surface overflow-x-auto rounded-md p-4 text-xs whitespace-pre-wrap">
            {JSON.stringify(detail.version.payload, null, 2)}
          </pre>
        </section>
      )}
      <section aria-label="Version items" className="flex flex-col gap-4">
        {detail.items.length ? (
          detail.items.map((item) => {
            const itemCauses = causes.filter(
              (cause) => cause.subjectItemVersionId === item.itemVersionId,
            );
            return (
              <article
                id={`item-${item.itemVersionId}`}
                key={item.itemVersionId}
                className="bg-surface-container-lowest border-surface-dim scroll-mt-6 rounded-lg border p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-on-surface font-mono-code text-base font-semibold">
                    {item.displayKey}
                  </h2>
                  <span className="text-on-surface-variant text-xs">
                    Revision {item.revisionNumber}
                  </span>
                  {itemCauses.length > 0 && (
                    <FlaggedGlyph
                      title={`${item.displayKey} may be affected by an upstream change`}
                    />
                  )}
                </div>
                {itemCauses.length > 0 && (
                  <div className="mt-4 flex flex-col gap-3">
                    {itemCauses.map((cause) => (
                      <div
                        id={`cause-${item.itemVersionId}-${cause.rootItemVersionId}`}
                        key={cause.rootItemVersionId}
                        className="bg-surface-container-low border-surface-dim scroll-mt-6 rounded-md border p-4"
                      >
                        <p className="text-on-surface text-sm font-medium">
                          Potentially affected by {cause.pathLabels[0]} ·{' '}
                          {cause.acknowledged ? 'Acknowledged' : 'Review recommended'}
                        </p>
                        <p className="text-on-surface-variant mt-2 text-xs">
                          Dependency path: {cause.pathLabels.join(' → ')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <pre className="bg-surface-container-low text-on-surface mt-4 overflow-x-auto rounded-md p-4 text-xs whitespace-pre-wrap">
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
              </article>
            );
          })
        ) : (
          <p className="text-on-surface-variant text-sm">This version contains no lineage items.</p>
        )}
      </section>
    </main>
  );
}
