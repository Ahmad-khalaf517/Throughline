// Module 8: architecture-materialization
// Owns: architecture_option
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// The option write side implements Module Boundaries 4.9 / FR-020..022.
// The two read-only getters below were pulled forward by E4-S2 (SCRUM-51)
// because `github.previewInit`/`initRepo` cannot function without them:
// FR-031's scaffold-vs-docs-only decision needs the selected option's stack
// descriptor, and FR-033/034 needs the ADR item versions an Architecture
// version actually materialized. Both are PURE reads through this module's
// own owned table (architecture_option) plus one documented cross-layer
// read (see below) - neither one is a write path, a state-machine
// transition. `getOptionsForVersion` was added later by E3-S10 (SCRUM-45):
// the same kind of plain read of this module's own table, for the API layer's
// `ArtifactVersionDTO.options`.
import { asc, eq } from 'drizzle-orm';
import { db, schema, withTx } from '@/db';
import { getSourceVersionMembers } from '@/lineage/identity';

export {
  createOptions,
  selectOption,
  materialize,
  ArchitectureOptionError,
  type OptionInput,
  type ArchitectureApprovalCode,
} from './materialize';

export type ArchitectureOption = typeof schema.architectureOption.$inferSelect;

export interface SelectedArchitectureOption {
  // `artifact_version` and `project` are owned by artifact-lifecycle
  // (Module Boundaries 4.3/4.4), not this module - but `artifact_version`
  // and `architecture_option` are the ERD's own documented one real FK
  // cycle (src/db/schema/artifact-version.ts's header comment: "the
  // selected option must belong to THIS version"), and this story's own
  // instructions ask for exactly this join ("joins
  // artifactVersion.selectedArchitectureOptionId to architectureOption").
  // `projectId`/`artifactId`/`versionNumber` are the same join's other
  // columns, added here (a superset of the story's own illustrative
  // return-type example) because `github` genuinely cannot function
  // without `projectId` - it needs it for the operationKey, the
  // runOperation call, and the impact-preview lookup - and there is no
  // OTHER reachable read path for it: eslint.config.mjs's
  // layer5-external-provider rule does not permit a layer-5 module to
  // import layer2-artifact-lifecycle (a peer of this module) even
  // indirectly through its own layer-3 pass-through, so re-deriving
  // projectId anywhere else would need a second, undocumented cross-layer
  // hop instead of one already-justified extra column on this same query.
  projectId: string;
  artifactId: string;
  versionNumber: number;
  versionStatus: string;
  option: ArchitectureOption;
}

/**
 * The Architecture artifact_version's selected option (FR-022: "recorded on
 * the approved ArtifactVersion itself... set only at approval"), joined to
 * its full row (FR-031's stack descriptor lives on `option.stack`). `null`
 * when the version has no selection yet (still draft, or - defensively -
 * doesn't exist).
 */
export async function getSelectedOption(
  artifactVersionId: string,
): Promise<SelectedArchitectureOption | null> {
  const [row] = await db
    .select({
      projectId: schema.artifact.projectId,
      artifactId: schema.artifactVersion.artifactId,
      versionNumber: schema.artifactVersion.versionNumber,
      versionStatus: schema.artifactVersion.status,
      option: schema.architectureOption,
    })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .innerJoin(
      schema.architectureOption,
      eq(schema.architectureOption.id, schema.artifactVersion.selectedArchitectureOptionId),
    )
    .where(eq(schema.artifactVersion.id, artifactVersionId))
    .limit(1);
  return row ?? null;
}

/**
 * Every `architecture_option` of one Architecture `artifact_version` - the
 * exactly-two rows `createOptions` inserted, `option_key` 'A' then 'B'
 * (Jira E3-S10 / SCRUM-45: `ArtifactVersionDTO.options` and the generate/
 * approve routes' option ids). A plain read of this module's own table;
 * `[]` for a version that has none (not an Architecture version, an
 * unknown id, or a stale-rejected generation, which never persists options).
 * `option_key` is CHECK-constrained to 'A' | 'B', so ascending text order is
 * A-then-B.
 */
export async function getOptionsForVersion(
  artifactVersionId: string,
): Promise<ArchitectureOption[]> {
  return db
    .select()
    .from(schema.architectureOption)
    .where(eq(schema.architectureOption.artifactVersionId, artifactVersionId))
    .orderBy(asc(schema.architectureOption.optionKey));
}

export type ArchitectureDecisionItem = Awaited<ReturnType<typeof getSourceVersionMembers>>[number];

/**
 * The ADR LogicalItem/ItemVersion rows an Architecture artifact_version
 * actually materialized (TR FR-034's "the exact Throughline item versions
 * that produced each approved architecture decision"). Delegates to
 * `identity.getSourceVersionMembers` (a plain read, no lock needed) rather
 * than querying `logical_item`/`item_version` directly - this module is the
 * ONE documented exception allowed to call into `identity`
 * (Module Boundaries section 2: "architecture-materialization (layer 2)
 * calls into identity (layer 1)"), reused here for a read the same way it's
 * used for selected-option materialization. Every member of
 * an Architecture artifact_version is, by construction, an
 * `architecture_decision` item (an artifact only ever holds items of its
 * own type) - no extra item_type filter is needed.
 */
export async function getArchitectureDecisionItems(
  architectureVersionId: string,
): Promise<ArchitectureDecisionItem[]> {
  return withTx((tx) => getSourceVersionMembers(tx, [architectureVersionId]));
}
