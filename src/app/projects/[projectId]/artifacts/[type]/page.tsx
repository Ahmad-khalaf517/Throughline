import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById, listArtifactVersions } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { ARTIFACT_TYPES, type ArtifactType } from '@/lib/serialize';
import { ArtifactReviewScreen } from '@/components/review/artifact-review-screen';
import { DocumentReviewScreen } from '@/components/review/document-review-screen';
import { loadReviewVersion } from '../load-review-version';

interface ArtifactReviewPageProps {
  params: Promise<{ projectId: string; type: string }>;
}

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  requirements: 'Requirements',
  architecture: 'Architecture',
  ui_requirements: 'UI Requirements',
  backlog: 'Backlog',
  brd: 'Business Requirements Document',
  erd: 'Entity Relationship Diagram',
};

function isArtifactType(value: string): value is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(value);
}

/**
 * Generic, type-parameterized artifact review screen (E5-S2; Jira Plan 1.6
 * option 2 - one route for all artifact types rather than bespoke
 * ones). Auth guard and `notFound()` mapping copied from
 * `projects/[projectId]/page.tsx` exactly (see that file's own comment for
 * why `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly
 * rather than left to bubble up).
 *
 * Reads real data via `loadReviewVersion` (SCRUM-86) - the newest version of
 * this artifact type, whatever its status, plus its quality issues - a
 * "read directly, write through api" page read (Module Boundaries 4.8), same
 * convention `getProjectById` below already uses. `null` means the artifact
 * has no versions yet - `ArtifactReviewScreen` renders a real "Generate"
 * trigger for that case (SCRUM-86 follow-up: `POST .../artifacts/:type/
 * generate`), not just a dead-end message, since a brand-new project would
 * otherwise have no way to ever get a first draft to review.
 */
export default async function ArtifactReviewPage({ params }: ArtifactReviewPageProps) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const { projectId, type } = await params;

  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }

  // The `:type` path segment is unvalidated user input (API Contracts 1.7) -
  // anything outside the six real artifact.type CHECK values 404s exactly
  // like an unknown project id would, never a 500.
  if (!isArtifactType(type)) {
    notFound();
  }

  const project = await getProjectById(projectId);
  if (!project) notFound();

  const reviewData = await loadReviewVersion(projectId, type);
  const documentHistory =
    type === 'brd' || type === 'erd'
      ? (await listArtifactVersions(projectId, type)).map((entry) => ({
          id: entry.id,
          versionNumber: entry.versionNumber,
          status: entry.status,
        }))
      : [];
  const artifactTypeName = ARTIFACT_TYPE_LABELS[type];

  return (
    <main
      className={`mx-auto flex min-h-screen w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 ${type === 'architecture' ? 'max-w-6xl' : 'max-w-5xl'}`}
    >
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← {project.name}
      </Link>

      {type === 'brd' || type === 'erd' ? (
        <DocumentReviewScreen
          projectId={projectId}
          type={type}
          title={artifactTypeName}
          version={reviewData?.version ?? null}
          history={documentHistory}
        />
      ) : reviewData ? (
        // Keyed by version id: a manual/AI revision mints a brand-new
        // `artifact_version` after this page's next read, and this key
        // forces `ArtifactReviewScreen` to remount (fresh local state) for
        // that new version rather than keeping stale state from the old one
        // (see that component's own comment on this).
        <ArtifactReviewScreen
          key={reviewData.version.id}
          projectId={projectId}
          artifactType={type}
          artifactTypeName={artifactTypeName}
          version={reviewData.version}
          qualityIssues={reviewData.qualityIssues}
          upstreamDisplayKeysByItemVersionId={reviewData.upstreamDisplayKeysByItemVersionId}
        />
      ) : (
        // Not a hard 404: the artifact type is real (it's one of the 6 CHECK
        // values), it just has no version yet (nothing has been generated
        // into it). `artifactType` is passed through explicitly (not derived
        // from a version, since there isn't one) so the screen's own
        // "Generate" trigger knows which `:type` to POST to.
        <ArtifactReviewScreen
          projectId={projectId}
          artifactType={type}
          artifactTypeName={artifactTypeName}
          version={null}
          qualityIssues={[]}
          upstreamDisplayKeysByItemVersionId={{}}
        />
      )}
    </main>
  );
}
