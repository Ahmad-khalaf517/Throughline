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
import { getProjectById } from '@/artifact-lifecycle';

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
