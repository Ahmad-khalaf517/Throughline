// Module 10: artifact-types/architecture
// Owns: architecture_decision items - payload shape + prompt only
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// buildPrompt/outputSchema/toCandidates/qualityGate (Module Boundaries 4.4's
// full ArtifactTypeModule shape) are E3-S7's job and do NOT exist yet - do
// not build them here. The two re-exports below are a narrow, additive
// exception pulled forward by E4-S2 (SCRUM-51): Module Boundaries 4.6
// documents `github.previewInit` as reading "the selected option's stack
// (via `architecture`, read-only)" - i.e. THIS module is `github`'s
// documented paired layer-3 read path, and eslint.config.mjs's
// layer5-external-provider rule mechanically enforces it (layer 5 may
// import layer3-artifact-types, but not layer1-identity or
// layer2-architecture-materialization directly). Both real implementations
// live in architecture-materialization (which owns `architecture_option`,
// and is separately the one module allowed to call into `identity` -
// Module Boundaries section 2) - this file only forwards them so `github`
// can reach that data without a second, undocumented cross-layer import or
// an eslint-disable (project convention: compose a thin read above the
// boundary, never disable the rule).
export {
  getSelectedOption,
  getArchitectureDecisionItems,
  type ArchitectureOption,
  type SelectedArchitectureOption,
  type ArchitectureDecisionItem,
} from '@/architecture-materialization';

import {
  createOptions as persistOptions,
  selectOption as validateSelection,
  materialize,
  type OptionInput,
} from '@/architecture-materialization';
import {
  withArchitectureDraft,
  approveVersion as approve,
  approveWithOverride as override,
} from '@/artifact-lifecycle';

export { ArchitectureOptionError, type OptionInput } from '@/architecture-materialization';

// Composition only: layer-2 peers never import each other. Lifecycle supplies
// its locked transaction/metadata; materialization owns the option writes.
export function createOptions(draftVersionId: string, options: [OptionInput, OptionInput]) {
  return withArchitectureDraft(draftVersionId, (tx, context) =>
    persistOptions(tx, context, options),
  );
}

export async function selectOption(draftVersionId: string, optionId: string): Promise<void> {
  await withArchitectureDraft(draftVersionId, (tx) =>
    validateSelection(tx, draftVersionId, optionId),
  );
}

export function approveVersion(versionId: string, actorId: string, selectedOptionId?: string) {
  return approve(versionId, actorId, { selectedOptionId, materialize });
}

export function approveWithOverride(
  versionId: string,
  actorId: string,
  note: string,
  selectedOptionId?: string,
) {
  return override(versionId, actorId, note, { selectedOptionId, materialize });
}
