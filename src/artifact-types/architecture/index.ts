// Module 10: artifact-types/architecture
// Owns: architecture_decision items - payload shape + prompt only
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// The generation surface - buildPrompt, outputSchema (exactly two options),
// toOptionInputs, toCandidates - lives in ./generation.ts (E3-S7, SCRUM-42) and
// is re-exported just below. There is deliberately no `qualityGate` (Module
// Boundaries 4.4: none specified for Architecture in P0) and no manual
// revision (regeneration only, ERD 3.6). `toCandidates` returns `[]`: decisions
// are not lineage until approval (ERD 5.5), so the options are persisted
// separately through the createOptions facade below. The generate ->
// createDraftFromGeneration -> createOptions orchestration is E3-S10's job.
// That includes loading what a regenerate `buildPrompt` call needs beyond the
// approved requirements: each base ADR's `upstreamRefs` (display keys of its
// bound upstream items - part of the ADR semantic hash, INV-016) and
// `baseStack` (the approved version's selected option's stack, compared by
// E3-S3's stack guard with a raw deep-equal). Both are required inputs; the
// wiring is not built here.
//
// The read re-exports after it are a narrow, additive
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
  outputSchema,
  buildPrompt,
  toOptionInputs,
  toCandidates,
  type ArchitectureOutput,
  type ArchitectureOptionOutput,
  type ArchitectureDecisionCandidate,
  type ArchitectureStackDescriptor,
  type ArchitectureGenerationContext,
  type ApprovedRequirementItem,
  type BaseArchitectureDecision,
} from './generation';

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
