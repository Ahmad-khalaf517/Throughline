// Module 12: artifact-types/backlog
// Owns: epic, story items - payload shape + prompt only
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// Jira E2-S9 (SCRUM-35) scope: ONLY the FR-080 generation-prerequisite
// refusal (T43 - "...and a Backlog before UI Requirements is approved.
// Refused"). buildPrompt/outputSchema/toCandidates (Module Boundaries 4.4's
// full ArtifactTypeModule shape, plus the parentDisplayKey -> Epic resolution
// Module Boundaries 4.4 documents for Backlog specifically) are out of scope
// for this story - see src/artifact-types/ui-requirements/index.ts's header
// comment for the same reasoning, mirrored here.
//
// `getBacklogVersionMembers` below is E4-S3's (SCRUM-52) own narrow addition
// - `jira.previewExport`/`exportBacklog` (Module Boundaries 4.6) need the
// Epic/Story LogicalItem/ItemVersion membership rows of one captured Backlog
// version, but `jira` (layer 5) cannot import `lineage/identity` (layer 1)
// directly (eslint.config.mjs's layer5-external-provider allow-list has no
// entry for layer1-identity - unlike `architecture-materialization`, which
// is layer 2 and the ONE documented cross-layer exception, Module Boundaries
// section 2). `backlog` (layer 3) CAN import `identity` directly (the
// layer3-artifact-types eslint rule allows layer1-identity) - this is the
// same "compose-above re-export" pattern `architecture.getArchitectureDecisionItems`
// established in E4-S2 for `github`, mirrored here for `jira`'s own paired
// layer-3 module. A pure read, no lock needed.
import { getProjectById } from '@/artifact-lifecycle';
import { withTx } from '@/db';
import { getSourceVersionMembers } from '@/lineage/identity';

/**
 * TR FR-080: "Backlog | Requires approved: Requirements, Architecture, UI
 * Requirements". Same mechanics as ui-requirements.generate - see that
 * file's doc comment.
 */
export async function generate(ctx: { projectId: string }): Promise<never> {
  const project = await getProjectById(ctx.projectId);
  if (!project) {
    throw new Error(`Project ${ctx.projectId} does not exist`);
  }

  const missing: string[] = [];
  if (!project.artifacts.requirements.approvedVersionId) missing.push('Requirements');
  if (!project.artifacts.architecture.approvedVersionId) missing.push('Architecture');
  if (!project.artifacts.ui_requirements.approvedVersionId) missing.push('UI Requirements');
  if (missing.length) {
    throw new Error(`Backlog generation requires approved ${missing.join(', ')} first (TR FR-080)`);
  }

  throw new Error(
    'backlog.generate: buildPrompt/outputSchema/toCandidates are out of scope for E2-S9 ' +
      '(SCRUM-35) - only the FR-080 prerequisite refusal (T43) is implemented here.',
  );
}

export type BacklogVersionMember = Awaited<ReturnType<typeof getSourceVersionMembers>>[number];

/**
 * The Epic/Story LogicalItem/ItemVersion membership rows of one captured
 * Backlog `artifact_version` - `jira.previewExport`/`exportBacklog`'s own
 * single per-call read (ERD 7.4: "capture the Backlog version once at
 * export start... a Backlog re-approval during a long export then cannot
 * mix versions within one export run"). Delegates entirely to
 * `identity.getSourceVersionMembers` (this file's header comment explains
 * why `jira` can't call it directly) - `backlog` never queries
 * `logical_item`/`item_version`/`artifact_version_item_membership` itself
 * (those tables belong to `identity`, Module Boundaries 4.2).
 */
export async function getBacklogVersionMembers(
  backlogVersionId: string,
): Promise<BacklogVersionMember[]> {
  return withTx((tx) => getSourceVersionMembers(tx, [backlogVersionId]));
}
