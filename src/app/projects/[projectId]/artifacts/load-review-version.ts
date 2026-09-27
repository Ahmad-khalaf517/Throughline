// Shared read composition for the artifact review screens (SCRUM-86). Two
// pages need "the newest version of this project's artifact of this type,
// with impact resolved and quality issues attached" - `artifacts/[type]/
// page.tsx` for its own type, `dependencies/page.tsx` for `'requirements'`
// specifically (TR section 27: the dependency view "must use the same
// dependency data and traversal rules as the warning engine," i.e. the same
// real read, not a second implementation). This file exists purely so that
// composition happens once.
//
// This is a page-adjacent helper, not a module: it lives under `src/app`
// (Module Boundaries's `app` element type), calls only layer-2/3 read
// exports directly per the "read directly, write through api" convention
// already used by `projects/page.tsx`/`projects/[projectId]/page.tsx`
// (Module Boundaries 4.8), and never reaches layer 0/1 (`db`, `identity`,
// `impact`) itself - `getArtifactVersionDetailResolved` already did that
// resolution inside artifact-lifecycle.
import { getArtifactVersionDetailResolved, listArtifactVersions } from '@/artifact-lifecycle';
import { getOptionsForVersion } from '@/artifact-types/architecture';
import { qualityGate as qualityGateBacklog } from '@/artifact-types/backlog';
import { qualityGate as qualityGateRequirements } from '@/artifact-types/requirements';
import {
  toArchitectureOptionDTO,
  toArtifactVersionDTO,
  toItemVersionDTO,
  type ArtifactType,
  type ArtifactVersionDTO,
  type QualityIssueDTO,
} from '@/lib/serialize';

export interface ReviewVersionData {
  version: ArtifactVersionDTO;
  qualityIssues: QualityIssueDTO[];
}

/**
 * The version a review screen shows for `(projectId, type)`: the newest
 * version of that artifact (there is no separate "pending review" flag in
 * the schema - the newest version, whatever its status, is what these
 * screens have always shown), with impact already resolved to display keys
 * and quality issues attached. `null` when the artifact has no versions yet
 * (the page renders its own "not available yet" state in that case, same as
 * the fixture-backed `null` path it replaces).
 */
export async function loadReviewVersion(
  projectId: string,
  type: ArtifactType,
): Promise<ReviewVersionData | null> {
  const versions = await listArtifactVersions(projectId, type);
  const latest = versions[0];
  if (!latest) return null;

  const detail = await getArtifactVersionDetailResolved(latest.id);
  if (!detail) return null;
  const { version, items } = detail;

  const options =
    version.artifactType === 'architecture'
      ? (await getOptionsForVersion(version.id)).map(toArchitectureOptionDTO)
      : null;

  const qualityIssues: QualityIssueDTO[] =
    version.artifactType === 'requirements'
      ? await qualityGateRequirements(version.id)
      : version.artifactType === 'backlog'
        ? await qualityGateBacklog(version.id)
        : [];

  return {
    version: toArtifactVersionDTO(
      version,
      items.map((item) => toItemVersionDTO(item, item.impact)),
      options,
    ),
    qualityIssues,
  };
}
