import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById, getProjectDashboard, type DashboardActivity } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { FlaggedGlyph, StatusBadge } from '@/components/status/status-badge';
import { ApiError } from '@/lib/errors';
import type { ArtifactType } from '@/lib/serialize';

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

const LABELS: Record<ArtifactType, string> = {
  requirements: 'Requirements',
  architecture: 'Architecture decisions',
  ui_requirements: 'UI requirements',
  backlog: 'Backlog epics & stories',
};

function formatDate(date: Date) {
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function activityHref(projectId: string, entry: DashboardActivity) {
  if (entry.kind === 'item_created' && entry.itemVersionId) {
    return `/projects/${projectId}/items/${entry.itemVersionId}`;
  }
  if (!entry.versionId) return `/projects/${projectId}`;
  const base = `/projects/${projectId}/versions/${entry.versionId}`;
  return entry.itemVersionId
    ? `${base}#cause-${entry.itemVersionId}-${entry.rootItemVersionId}`
    : base;
}

function ActivityRow({ projectId, entry }: { projectId: string; entry: DashboardActivity }) {
  const isImpact = entry.kind === 'current_impact';
  return (
    <li className="border-surface-dim border-b p-6 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {entry.displayKey && (
              <span className="font-mono-code text-on-surface text-xs font-semibold">
                {entry.displayKey}
              </span>
            )}
            <span className="text-on-surface text-sm font-medium">
              {isImpact
                ? 'Potentially affected'
                : entry.kind === 'item_created'
                  ? 'Item version created'
                  : 'Artifact version status changed'}
            </span>
            {entry.status && <StatusBadge status={entry.status} />}
            {isImpact && (
              <FlaggedGlyph title={`${entry.displayKey} may be affected by an upstream change`} />
            )}
          </div>
          <p className="text-on-surface-variant text-xs">
            {LABELS[entry.artifactType]}
            {entry.versionNumber ? ` · version ${entry.versionNumber}` : ' · retained item version'}
            {entry.revisionNumber && ` · item revision ${entry.revisionNumber}`}
            {isImpact &&
              (entry.causeDisplayKey
                ? ` · based on superseded ${entry.causeDisplayKey}`
                : ' · based on a superseded source')}
            {isImpact && entry.acknowledged && ' · acknowledged'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-on-surface-variant text-xs">
            {entry.at ? (
              <time dateTime={entry.at.toISOString()}>{formatDate(entry.at)}</time>
            ) : (
              'Current impact'
            )}
          </span>
          <Link
            href={activityHref(projectId, entry)}
            className="text-primary-container focus-visible:ring-primary rounded-md text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Inspect →
          </Link>
        </div>
      </div>
    </li>
  );
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');
  const { projectId } = await params;
  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const project = await getProjectById(projectId);
  if (!project) notFound();
  const dashboard = await getProjectDashboard(projectId);
  const hasVersions = dashboard.tiles.some((tile) => tile.versionId);
  const impacted = dashboard.activity.filter((entry) => entry.kind === 'current_impact');

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
          Project overview
        </p>
        <h1 className="text-on-surface mt-1 text-2xl font-semibold">Traceability at a glance</h1>
        <p className="text-on-surface-variant mt-2 text-sm">
          Current artifact versions and recent lineage activity for {project.name}.
        </p>
      </header>

      <section aria-label="Artifact status" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dashboard.tiles.map((tile) => (
          <div
            key={tile.type}
            className="bg-surface-container-lowest border-surface-dim flex flex-col gap-4 rounded-lg border p-6 shadow-sm"
          >
            <p className="text-on-surface-variant text-xs font-medium">{LABELS[tile.type]}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-on-surface text-2xl font-semibold">
                {tile.itemCount}
                <span className="text-on-surface-variant ml-1 text-xs font-normal">items</span>
              </p>
              {tile.status ? (
                <StatusBadge status={tile.status} />
              ) : (
                <span className="text-on-surface-variant text-xs">No version</span>
              )}
            </div>
            <Link
              href={
                tile.versionId
                  ? `/projects/${projectId}/versions/${tile.versionId}`
                  : `/projects/${projectId}/artifacts/${tile.type}`
              }
              className="text-primary-container focus-visible:ring-primary w-fit rounded-md text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {tile.versionId ? `Inspect version ${tile.versionNumber} →` : 'Open artifact →'}
            </Link>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <section
          aria-labelledby="activity-heading"
          className="bg-surface-container-lowest border-surface-dim overflow-hidden rounded-lg border shadow-sm lg:col-span-8"
        >
          <div className="border-surface-dim border-b p-6">
            <h2 id="activity-heading" className="text-on-surface text-base font-semibold">
              Recent activity & lineage
            </h2>
            <p className="text-on-surface-variant mt-1 text-xs">
              Newest changes first; impact entries show the current computed state.
            </p>
          </div>
          {dashboard.activity.length ? (
            <ol>
              {dashboard.activity.map((entry) => (
                <ActivityRow key={entry.id} projectId={projectId} entry={entry} />
              ))}
            </ol>
          ) : (
            <p className="text-on-surface-variant p-6 text-sm">
              No lineage activity yet. Generate an artifact to start the traceability chain.
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-6 lg:col-span-4">
          <section
            aria-labelledby="health-heading"
            className="bg-surface-container-lowest border-surface-dim rounded-lg border p-6 shadow-sm"
          >
            <h2 id="health-heading" className="text-on-surface text-base font-semibold">
              Project health
            </h2>
            {dashboard.flaggedItemCount ? (
              <div className="mt-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <FlaggedGlyph title="Current impact found" />
                  {dashboard.flaggedItemCount} potentially affected{' '}
                  {dashboard.flaggedItemCount === 1 ? 'item' : 'items'}
                </p>
                <p className="text-on-surface-variant mt-2 text-xs">
                  Review recommended for items based on a superseded source.
                </p>
                <ul className="mt-4 flex flex-col gap-2">
                  {impacted.slice(0, 4).map((entry) => (
                    <li key={entry.id}>
                      <Link
                        href={activityHref(projectId, entry)}
                        className="text-primary-container focus-visible:ring-primary rounded-md text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {entry.displayKey} · inspect impact →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-status-approved-text bg-status-approved-bg mt-4 rounded-md px-3 py-3 text-sm">
                ✓ No impact found. Current items have no flagged dependencies.
              </p>
            )}
          </section>
          <section
            aria-labelledby="brief-heading"
            className="bg-surface-container-lowest border-surface-dim rounded-lg border p-6 shadow-sm"
          >
            <h2 id="brief-heading" className="text-on-surface text-base font-semibold">
              Project brief
            </h2>
            <p className="text-on-surface-variant mt-1 text-xs">
              Created{' '}
              <time dateTime={project.createdAt.toISOString()}>
                {formatDate(project.createdAt)}
              </time>
            </p>
            <p className="text-on-surface mt-4 text-sm leading-relaxed whitespace-pre-wrap">
              {project.brief}
            </p>
          </section>
        </aside>
      </div>
      {!hasVersions && (
        <p className="text-on-surface-variant text-xs">
          All four artifact types are ready for their first version.
        </p>
      )}
    </main>
  );
}
