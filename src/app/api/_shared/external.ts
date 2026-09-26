// Shared route-handler glue for the GitHub/Jira/Stitch/external-refs routes
// (E4-S6, SCRUM-55; API Contracts sections 7-10). A Next.js "private folder"
// (`_shared`, opted out of routing by its leading underscore - see
// node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md
// "Private folders") rather than a `route.ts` itself, so this file has no
// URL of its own. It is still classified as `layer6-api` by
// `eslint.config.mjs`'s `boundaries/elements` pattern (`src/app/api/**`), so
// it is bound by the exact same layer6 import allow-list as every route
// handler - no domain logic lives here, only the "call a layer-3/4/5
// function, serialize the result" glue that section 7's own text
// ("called once per approved version and merged") requires more than one
// route to repeat identically (Module Boundaries 4.7).
import { ARTIFACT_TYPES } from '@/lib/serialize';
import type { ProjectWithArtifacts } from '@/artifact-lifecycle';
import {
  getRefsForVersion,
  getDisplayKeysForItemVersions,
  type ExternalRef,
} from '@/external/operations';
import { checkDrift as checkGithubDrift } from '@/external/github';
import { checkDrift as checkJiraDrift } from '@/external/jira';
import { checkDrift as checkStitchDrift } from '@/external/stitch';
import {
  toExternalRefDTO,
  toImpactRowDTO,
  type ExternalRefDTO,
  type ImpactRowDTO,
  type ImpactRowInput,
} from '@/lib/serialize';

/**
 * Every non-null approved-version id across a project's 4 artifact types
 * (API Contracts section 7's own text for `GET .../external-refs`: "called
 * once per approved version and merged"). GitHub/Stitch refs are always
 * sourced from exactly one of these (`architecture`/`ui_requirements`); Jira
 * refs from `backlog` - this list is exhaustive across all three providers,
 * so merging `external-operations.getRefsForVersion` over it is a complete
 * project-wide read with no separate "refs by project" export needed
 * (`external-operations` only ever indexes by version/item, Module
 * Boundaries 4.5).
 */
function approvedVersionIds(project: ProjectWithArtifacts): string[] {
  return ARTIFACT_TYPES.map((type) => project.artifacts[type].approvedVersionId).filter(
    (id): id is string => id !== null,
  );
}

/** Every `external_ref` this project has ever produced, across every provider (routes 1 and 6). */
export async function getAllExternalRefsForProject(
  project: ProjectWithArtifacts,
): Promise<ExternalRef[]> {
  const refsPerVersion = await Promise.all(
    approvedVersionIds(project).map((id) => getRefsForVersion(id)),
  );
  return refsPerVersion.flat();
}

/**
 * Dispatches a drift check to the ref's own provider module - the layer-6
 * reachable substitute for calling `impact.getExternalDrift` directly (which
 * `layer6-api` may not import, eslint.config.mjs's allow-list has no
 * `layer1-impact` entry). `github.checkDrift` is Module Boundaries 4.6's
 * documented delegator for this; `jira`/`stitch` gained the same delegate
 * this story (their own header comments explain why they didn't have one
 * yet).
 */
function checkDriftForRef(ref: ExternalRef) {
  switch (ref.provider) {
    case 'github':
      return checkGithubDrift(ref.id);
    case 'jira':
      return checkJiraDrift(ref.id);
    case 'stitch':
      return checkStitchDrift(ref.id);
    default:
      // external_ref_provider_check guarantees one of the three above.
      throw new Error(`unknown external_ref.provider '${ref.provider}' for ref ${ref.id}`);
  }
}

/** Every id an `ImpactRowInput` could reference (its own root plus every path entry). */
function collectItemVersionIds(rows: readonly ImpactRowInput[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.rootItemVersionId);
    for (const id of row.path) ids.add(id);
  }
  return [...ids];
}

/**
 * Batch-converts a list of raw `ImpactRow`s (from `previewInit`/
 * `previewExport`/`previewPrompt`, or the item-level `impact` array on any
 * of them) into `ImpactRowDTO[]` - one display-key round trip for the whole
 * list, never one per row (this route family's own contract note for
 * `GET .../external-refs`, applied consistently everywhere else an
 * `ImpactRow[]` needs to become wire format).
 */
export async function toImpactRowDTOs(rows: readonly ImpactRowInput[]): Promise<ImpactRowDTO[]> {
  if (!rows.length) return [];
  const displayKeys = await getDisplayKeysForItemVersions(collectItemVersionIds(rows));
  return rows.map((row) => toImpactRowDTO(row, displayKeys));
}

/**
 * Batch-serializes a list of `ExternalRef`s into `ExternalRefDTO[]`,
 * computing each one's *current* drift fresh (never trusting a stale value)
 * and resolving every display key the resulting impact rows reference in
 * one shared round trip - the "per ref call the provider's checkDrift;
 * batch-resolve display keys once" shape `GET .../external-refs` (API
 * Contracts section 7) and `POST .../jira/export` (its own `created` list)
 * both need.
 */
export async function serializeRefsWithFreshDrift(refs: ExternalRef[]): Promise<ExternalRefDTO[]> {
  const impacts = await Promise.all(refs.map((ref) => checkDriftForRef(ref)));
  const presentImpacts = impacts.filter((impact): impact is ImpactRowInput => impact !== null);
  const displayKeys = await getDisplayKeysForItemVersions(collectItemVersionIds(presentImpacts));
  return refs.map((ref, index) => {
    const impact = impacts[index];
    return toExternalRefDTO(ref, impact ? toImpactRowDTO(impact, displayKeys) : null);
  });
}

/** Single-ref convenience wrapper around {@link serializeRefsWithFreshDrift} for the routes that only ever build one `ExternalRefDTO` at a time. */
export async function serializeRefWithFreshDrift(ref: ExternalRef): Promise<ExternalRefDTO> {
  const [dto] = await serializeRefsWithFreshDrift([ref]);
  if (!dto) {
    // serializeRefsWithFreshDrift always returns exactly one entry per input ref.
    throw new Error(`serializeRefWithFreshDrift: no DTO produced for ref ${ref.id}`);
  }
  return dto;
}
