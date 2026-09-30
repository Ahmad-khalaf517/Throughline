import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight, GitBranch, Layers3, LayoutTemplate, ListTodo } from 'lucide-react';
import {
  getDocumentSourceCurrentness,
  getProjectById,
  getProjectDashboard,
  type DashboardActivity,
} from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ProjectJourney } from '@/components/projects/project-journey';
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
  brd: 'Business requirements document',
  erd: 'Entity relationship diagram',
};

const TILE_ICONS = {
  requirements: ListTodo,
  architecture: Layers3,
  ui_requirements: LayoutTemplate,
  backlog: GitBranch,
  brd: ListTodo,
  erd: Layers3,
} as const;

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

function itemNoun(count: number) {
  return count === 1 ? 'item' : 'items';
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
  const itemEntry = entry.kind === 'item_created' || isImpact;
  const isVersionCreation =
    entry.kind === 'version_status' && entry.id.startsWith('version-created-');
  return (
    <li className="border-surface-dim hover:bg-surface-container-low/50 border-b p-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {entry.displayKey && (
              <span className="font-mono-code bg-surface-container-low border-surface-dim text-on-surface rounded-md border px-2 py-1 text-xs font-semibold">
                {entry.displayKey}
              </span>
            )}
            <span className="text-on-surface line-clamp-2 text-sm font-medium">
              {itemEntry && entry.summaryTitle
                ? entry.summaryTitle
                : isImpact
                  ? 'Potentially affected item'
                  : entry.kind === 'item_created'
                    ? 'Item version created'
                    : isVersionCreation
                      ? 'Artifact version created'
                      : 'Artifact version status changed'}
            </span>
            {entry.status && <StatusBadge status={entry.status} />}
            {isImpact && (
              <FlaggedGlyph title={`${entry.displayKey} may be affected by an upstream change`} />
            )}
          </div>
          {entry.summaryNarrative && (
            <p className="text-on-surface-variant line-clamp-2 text-xs leading-relaxed">
              {entry.summaryNarrative}
            </p>
          )}
          <p className="text-on-surface-variant text-xs">
            {isImpact
              ? 'Current impact'
              : entry.kind === 'item_created'
                ? 'Item version created'
                : isVersionCreation
                  ? 'Version created'
                  : 'Status change'}{' '}
            · {LABELS[entry.artifactType]}
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
  const documentCurrentness = new Map(
    await Promise.all(
      dashboard.tiles
        .filter((tile) => (tile.type === 'brd' || tile.type === 'erd') && tile.versionId)
        .map(
          async (tile) => [tile.type, await getDocumentSourceCurrentness(tile.versionId!)] as const,
        ),
    ),
  );
  const hasVersions = dashboard.tiles.some((tile) => tile.versionId);
  const impacted = dashboard.activity.filter((entry) => entry.kind === 'current_impact');
  const firstImpact = impacted[0];
  const itemsInShownVersions = dashboard.tiles.reduce((count, tile) => count + tile.itemCount, 0);

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div>
          <p className="app-kicker">Overview / {project.name}</p>
          <h1 className="app-display text-on-surface mt-2 text-[clamp(2.25rem,4vw,3.5rem)] leading-tight">
            Where the plan stands.
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm">
            See what is ready, what needs review, and how decisions connect.
          </p>
        </div>
        <span className="border-surface-dim bg-surface-container-lowest text-on-surface-variant rounded-full border px-3 py-1.5 text-xs font-medium">
          {itemsInShownVersions} {itemNoun(itemsInShownVersions)} in current versions
        </span>
      </header>

      <ProjectJourney projectId={projectId} tiles={dashboard.tiles} />

      <section aria-labelledby="artifacts-heading">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="app-kicker">The working set</p>
            <h2
              id="artifacts-heading"
              className="text-on-surface mt-1 text-lg font-semibold tracking-tight"
            >
              Artifacts
            </h2>
          </div>
          <span className="text-on-surface-variant text-xs">
            Open a card to inspect its current version
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {dashboard.tiles.map((tile) => {
            const Icon = TILE_ICONS[tile.type];
            return (
              <Link
                key={tile.type}
                href={
                  tile.type === 'brd' || tile.type === 'erd'
                    ? `/projects/${projectId}/artifacts/${tile.type}`
                    : tile.versionId
                      ? `/projects/${projectId}/versions/${tile.versionId}`
                      : `/projects/${projectId}/artifacts/${tile.type}`
                }
                className="app-card app-card-link group flex min-h-48 flex-col justify-between gap-4 p-5 focus-visible:outline-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="app-accent-soft flex size-9 items-center justify-center rounded-lg">
                    <Icon className="size-4.5" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="text-on-surface-variant shrink-0 font-mono text-xs">
                    {tile.versionNumber ? `v${tile.versionNumber}` : 'No version'}
                  </span>
                </div>
                <div>
                  <p className="text-on-surface text-sm font-semibold">{LABELS[tile.type]}</p>
                  {tile.type === 'brd' || tile.type === 'erd' ? (
                    <p className="text-on-surface-variant mt-2 text-sm">
                      {tile.versionId ? 'Document generated' : 'No document yet'}
                    </p>
                  ) : (
                    <p className="text-on-surface mt-2 text-3xl font-semibold tracking-tight">
                      {tile.itemCount}
                      <span className="text-on-surface-variant ml-1 text-xs font-normal">
                        {itemNoun(tile.itemCount)}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {tile.status ? (
                    <StatusBadge status={tile.status} />
                  ) : (
                    <span className="text-on-surface-variant text-xs">Not generated</span>
                  )}
                  {documentCurrentness.get(tile.type) === false && (
                    <span className="text-status-draft-text inline-flex items-center gap-1 text-xs font-medium">
                      Needs regeneration
                    </span>
                  )}
                </div>
                <span className="text-primary inline-flex items-center gap-1 text-xs font-semibold group-hover:underline group-focus-visible:underline">
                  {tile.versionId ? 'Inspect version' : 'Open artifact'}{' '}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <section
          aria-labelledby="activity-heading"
          className="app-card overflow-hidden lg:col-span-8"
        >
          <div className="border-surface-dim flex flex-wrap items-start justify-between gap-3 border-b p-6">
            <div>
              <h2 id="activity-heading" className="text-on-surface text-base font-semibold">
                Recent activity & lineage
              </h2>
              <p className="text-on-surface-variant mt-1 text-xs">
                Newest changes first; impact entries show the current computed state.
              </p>
            </div>
            <span className="bg-surface-container-low text-on-surface-variant rounded-md px-2 py-1 text-xs">
              Showing {dashboard.activity.length}{' '}
              {dashboard.activity.length === 1 ? 'entry' : 'entries'}
            </span>
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
          <section aria-labelledby="health-heading" className="app-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="health-heading" className="text-on-surface text-base font-semibold">
                Project health
              </h2>
              <span className="bg-surface-container-low border-surface-dim text-on-surface-variant rounded-md border px-2 py-1 text-xs font-medium">
                {dashboard.flaggedItemCount} flagged{' '}
                {dashboard.flaggedItemCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            {dashboard.flaggedItemCount ? (
              <div className="bg-surface-container-low border-surface-dim mt-4 rounded-lg border p-4">
                <div className="flex items-start gap-2">
                  <FlaggedGlyph title="Current impact found" className="mt-1" />
                  <div>
                    <p className="text-on-surface text-sm font-medium">
                      {firstImpact?.displayKey ?? 'An item'} may be affected
                      {firstImpact?.causeDisplayKey
                        ? ` by ${firstImpact.causeDisplayKey}`
                        : ' by an upstream change'}
                      .
                    </p>
                    <p className="text-on-surface-variant mt-2 text-xs leading-relaxed">
                      {firstImpact?.summaryTitle ? `${firstImpact.summaryTitle} · ` : ''}Review
                      recommended for this dependency.
                    </p>
                    {firstImpact && (
                      <Link
                        href={activityHref(projectId, firstImpact)}
                        className="text-primary-container focus-visible:ring-primary mt-3 inline-flex rounded-md text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        Inspect this cause →
                      </Link>
                    )}
                  </div>
                </div>
                <Link
                  href={`/projects/${projectId}/warnings`}
                  className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary mt-4 flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Review impact
                </Link>
              </div>
            ) : (
              <p className="text-status-approved-text bg-status-approved-bg mt-4 rounded-md px-3 py-3 text-sm">
                ✓ No impact found. Current items have no flagged dependencies.
              </p>
            )}
            <div className="border-surface-dim mt-4 flex items-center justify-between gap-2 border-t pt-4 text-xs">
              <span className="text-on-surface-variant">Items in shown versions</span>
              <span className="text-on-surface font-semibold">
                {itemsInShownVersions} {itemNoun(itemsInShownVersions)}
              </span>
            </div>
          </section>
          <section aria-labelledby="brief-heading" className="app-card p-6">
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
          All six artifact types are ready for their first version.
        </p>
      )}
    </main>
  );
}
