// Module 1: db
// Owns: Drizzle client, connection, withProjectLock(), transaction helper
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
export { db } from './client';
export { withProjectLock, withTx, type Tx } from './lock';
export * as schema from './schema';
