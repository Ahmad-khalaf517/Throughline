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
import { getProjectById } from '@/artifact-lifecycle';

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
