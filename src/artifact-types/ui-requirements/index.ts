// Module 11: artifact-types/ui-requirements
// Owns: ui_requirement items - payload shape + prompt only
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// Jira E2-S9 (SCRUM-35) scope: ONLY the FR-080 generation-prerequisite
// refusal (T43 - "Try to generate UI Requirements before Architecture is
// approved... refused"). buildPrompt/outputSchema/toCandidates (Module
// Boundaries 4.4's full ArtifactTypeModule shape) are out of scope for this
// story - this module's `generate` always throws, either with the
// prerequisite error or, once prerequisites are met, with a plain
// not-implemented error. Building the real prompt/schema/mapping is a later
// story's job.
//
// `getUiRequirementsForPrompt` below is E4-S4's (SCRUM-53) own narrow
// addition - `stitch.previewPrompt`/`generate` (Module Boundaries 4.6) need
// this UI Requirements version's own item content (the ui_requirement
// payload fields FR-050's "generated structured UI prompt" is built from),
// but `stitch` (layer 5) cannot import `lineage/identity` (layer 1) directly
// (eslint.config.mjs's layer5-external-provider allow-list has no entry for
// layer1-identity, only layer3-artifact-types - the same reasoning
// `backlog.getBacklogVersionMembers`'s own header comment gives for `jira`).
//
// `identity.getSourceVersionMembers` now also selects `item_version.payload`
// (added for this story) - so, exactly like `backlog.getBacklogVersionMembers`
// does for `jira`, this function is a thin "compose-above re-export" that
// delegates entirely to that shared read (Module Boundaries principle 1:
// `identity`/`artifact-lifecycle` own `logical_item` / `item_version` /
// `artifact_version_item_membership` / `artifact_version` / `artifact`, this
// module queries none of them directly). Rows are filtered to
// `itemType === 'ui_requirement'` defensively, even though a UI Requirements
// artifact_version's members are, by construction, only ever that type (an
// artifact only ever holds items of its own type), and to rows with a
// non-null `logicalItemId`/`itemVersionId`/`displayKey` - mirroring the same
// LEFT JOIN null-guard style `jira`'s `resolveDecisionNeed`/`exportOneItem`
// already use, since a version with zero real members returns one row with
// nulls throughout (`getSourceVersionMembers`'s own contract).
import { getProjectById } from '@/artifact-lifecycle';
import { withTx } from '@/db';
import { getSourceVersionMembers } from '@/lineage/identity';

/**
 * TR FR-080: "UI Requirements | Requires approved: Requirements,
 * Architecture". Checked via artifact-lifecycle.getProjectById - the real
 * exported read for "does this project have an approved version of artifact
 * type X" (Module Boundaries principle 1: ui-requirements does not own
 * `artifact`/`artifact_version` and must not query them directly).
 *
 * Called as the `generate` callback createDraftFromGeneration expects
 * (Module Boundaries 4.3): thrown BEFORE any OpenAI call and before the
 * project lock is taken, so a failed prerequisite check never opens a
 * transaction and never writes a row (generation.ts's own header comment -
 * "if it throws, the exception propagates as-is: no lock, no transaction, no
 * row written").
 */
export async function generate(ctx: { projectId: string }): Promise<never> {
  const project = await getProjectById(ctx.projectId);
  if (!project) {
    throw new Error(`Project ${ctx.projectId} does not exist`);
  }

  const missing: string[] = [];
  if (!project.artifacts.requirements.approvedVersionId) missing.push('Requirements');
  if (!project.artifacts.architecture.approvedVersionId) missing.push('Architecture');
  if (missing.length) {
    throw new Error(
      `UI Requirements generation requires approved ${missing.join(' and ')} first (TR FR-080)`,
    );
  }

  throw new Error(
    'ui-requirements.generate: buildPrompt/outputSchema/toCandidates are out of scope for ' +
      'E2-S9 (SCRUM-35) - only the FR-080 prerequisite refusal (T43) is implemented here.',
  );
}

export interface UiRequirementItemForPrompt {
  logicalItemId: string;
  itemVersionId: string;
  displayKey: string;
  // jsonb, shape not yet structurally validated anywhere (no
  // outputSchema/toCandidates exists for this artifact type - E2-S9's own
  // stub scope) - `stitch`'s own prompt builder reads the ERD 5.4 projection
  // fields (screenOrFlow, interactionRequirement, responsiveConstraints,
  // accessibilityConstraints; src/lineage/identity/projection.ts's
  // `semanticProjection('ui_requirement', ...)` field list) out of this
  // defensively.
  payload: unknown;
}

export interface UiRequirementsVersionForPrompt {
  projectId: string;
  status: string;
  items: UiRequirementItemForPrompt[];
}

/**
 * One UI Requirements `artifact_version`'s own status/projectId plus its
 * `ui_requirement` members' exact content (`item_version.payload`) -
 * delegates entirely to `identity.getSourceVersionMembers` (this file's
 * header comment explains why). Throws if the version itself does not exist
 * (`getSourceVersionMembers`'s own "Unknown context source version" check);
 * returns `items: []` (never throws) for a version that exists but
 * genuinely has no `ui_requirement` members yet (e.g. a freshly-created
 * draft before generation has run) - callers decide what that means for
 * them (`stitch.previewPrompt`/`generate` both check `status` before ever
 * looking at `items`).
 */
export async function getUiRequirementsForPrompt(
  uiRequirementsVersionId: string,
): Promise<UiRequirementsVersionForPrompt> {
  const members = await withTx((tx) => getSourceVersionMembers(tx, [uiRequirementsVersionId]));
  const [first] = members;
  if (!first) {
    // getSourceVersionMembers throws its own "Unknown context source
    // version" when the id doesn't exist at all - reaching here with zero
    // rows would mean a real artifact_version with literally no members,
    // which callers never construct in practice.
    throw new Error(`ui_requirements artifact_version ${uiRequirementsVersionId} has no members`);
  }

  const items: UiRequirementItemForPrompt[] = members.flatMap((member) => {
    if (
      member.itemType !== 'ui_requirement' ||
      !member.logicalItemId ||
      !member.itemVersionId ||
      !member.displayKey
    ) {
      return [];
    }
    return [
      {
        logicalItemId: member.logicalItemId,
        itemVersionId: member.itemVersionId,
        displayKey: member.displayKey,
        payload: member.payload,
      },
    ];
  });

  return { projectId: first.projectId, status: first.status, items };
}
