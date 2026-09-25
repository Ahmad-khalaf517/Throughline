// Module 3: ai-client
// Owns: ai_generation_run - the only module that calls the LLM provider
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
export { generateStructured } from './generate-structured';
export type {
  GenerateStructuredOptions,
  GenerateStructuredResult,
  GenerationPurpose,
} from './generate-structured';
export { linkGenerationRun } from './link-generation-run';
