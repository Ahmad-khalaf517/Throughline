import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';
import { ARTIFACT_TYPES, type ArtifactType } from '@/lib/serialize';
import { ArtifactReviewScreen } from '@/components/review/artifact-review-screen';
import { getFixtureArtifactVersion } from '@/components/review/fixtures';

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
 * Generic, type-parameterized artifact review screen (E5-S2; Jira Plan 1.6
 * option 2 - one screen for all four artifact types rather than four bespoke
 * ones). Auth guard and `notFound()` mapping copied from
 * `projects/[projectId]/page.tsx` exactly (see that file's own comment for
 * why `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly
 * rather than left to bubble up).
 *
 * E3-S10 (the artifact API routes) doesn't exist yet, so this page reads
 * fixture data via `getFixtureArtifactVersion` instead of a real route -
 * see that function's header comment for the swap point. `getProjectById`
 * is still a real read (E1-S8), used here only for the project name shown
 * above the review screen, not for artifact data.
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

  const fixture = getFixtureArtifactVersion(type);
  const artifactTypeName = ARTIFACT_TYPE_LABELS[type];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← {project.name}
      </Link>

      {fixture ? (
        <ArtifactReviewScreen
          artifactTypeName={artifactTypeName}
          version={fixture.version}
          qualityIssues={fixture.qualityIssues}
        />
      ) : (
        // Not a hard 404: the artifact type is real (it's one of the 4 CHECK
        // values), it just doesn't have a fixture yet (E5-S3/S4/S5 add the
        // other 3). Reads as "coming soon" rather than a broken link -
        // `ArtifactReviewScreen` renders the same message if it's ever
        // handed `version={null}` directly, but the page checks first so a
        // reader never even sees the component render before this decides.
        <ArtifactReviewScreen
          artifactTypeName={artifactTypeName}
          version={null}
          qualityIssues={[]}
        />
      )}
    </main>
  );
}
