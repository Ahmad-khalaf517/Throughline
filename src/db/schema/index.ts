// Re-exports every table group. One file per table (Project Setup section
// 3), except artifact-version.ts, which also holds architecture_option -
// the ERD's one real FK cycle, kept together deliberately (see that file's
// header). All 16 ERD tables (Appendix A), matching each table's frozen DDL
// exactly - see docs/Throughline_ERD.md Appendix A.1.
export * from './app-user';
export * from './project';
export * from './artifact';
export * from './artifact-version'; // artifactVersion + architectureOption
export * from './approval-event';
export * from './logical-item';
export * from './item-version';
export * from './artifact-version-item-membership';
export * from './generation-context-ref';
export * from './semantic-dependency';
export * from './external-operation';
export * from './external-ref';
export * from './impact-acknowledgement';
export * from './ai-generation-run';
export * from './stitch-output';
