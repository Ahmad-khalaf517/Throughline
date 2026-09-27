import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { ARTIFACT_TYPES, type ArtifactType, type QualityIssueDTO } from '@/lib/serialize';
import { ArtifactGenerationPanel } from '@/components/review/artifact-generation-panel';
import {
  ARTIFACT_TYPE_DISPATCH,
  loadVersionDTO,
  missingPrerequisites,
} from '@/app/api/_shared/artifacts';

interface ArtifactReviewPageProps {
  params: Promise<{ projectId: string; type: string }>;
}

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  requirements: 'Requirements',
  architecture: 'Architecture',
  ui_requirements: 'UI Requirements',
  backlog: 'Backlog',
};

function isArtifactType(value: string): value is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(value);
}

/**
 * Loads this artifact type's quality issues the same way
 * `GET /api/artifact-versions/:versionId/quality-gate` does (Architecture and
 * UI Requirements have no gate in P0 - Module Boundaries 4.4 - so they always
 * get `[]`), narrowed to the wire shape rather than whatever extra fields the
 * domain type happens to carry.
 */
async function loadQualityIssues(
  type: ArtifactType,
  versionId: string,
): Promise<QualityIssueDTO[]> {
  const { qualityGate } = ARTIFACT_TYPE_DISPATCH[type];
  if (!qualityGate) return [];
  const issues = await qualityGate(versionId);
  return issues.map(({ code, message, logicalItemId }) => ({ code, message, logicalItemId }));
}

/**
 * Generic, type-parameterized artifact review screen (E5-S2; Jira Plan 1.6
 * option 2 - one screen for all four artifact types rather than four bespoke
 * ones). Auth guard and `notFound()` mapping copied from
 * `projects/[projectId]/page.tsx` exactly (see that file's own comment for
 * why `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly
 * rather than left to bubble up).
 *
 * Reads the real current version (draft over approved - the more relevant
 * one to review) via `@/app/api/_shared/artifacts`' route-handler glue
 * directly, the same "artifact/version-route exception" the routes
 * themselves document (Module Boundaries 4.7) - this page is now `app`
 * calling `layer6-api`'s shared DTO builder rather than a fixture. `null`
 * means this artifact type has never been generated; `ArtifactGenerationPanel`
 * owns the real `POST .../generate` call and its own loading state from there.
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
  // anything outside the four real artifact.type CHECK values 404s exactly
  // like an unknown project id would, never a 500.
  if (!isArtifactType(type)) {
    notFound();
  }

  const project = await getProjectById(projectId);
  if (!project) notFound();

  const summary = project.artifacts[type];
  const versionId = summary.draftVersionId ?? summary.approvedVersionId;
  const version = versionId ? await loadVersionDTO(versionId) : null;
  const qualityIssues = versionId ? await loadQualityIssues(type, versionId) : [];
  const missingPrerequisiteNames = missingPrerequisites(project, type).map(
    (candidate) => ARTIFACT_TYPE_LABELS[candidate],
  );
  const artifactTypeName = ARTIFACT_TYPE_LABELS[type];

  return (
    <main
      className={`mx-auto flex min-h-screen w-full flex-col gap-6 px-4 py-12 sm:px-6 ${type === 'architecture' ? 'max-w-6xl' : 'max-w-5xl'}`}
    >
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← {project.name}
      </Link>

      <ArtifactGenerationPanel
        projectId={projectId}
        type={type}
        artifactTypeName={artifactTypeName}
        initialVersion={version}
        initialQualityIssues={qualityIssues}
        missingPrerequisiteNames={missingPrerequisiteNames}
      />
    </main>
  );
}
