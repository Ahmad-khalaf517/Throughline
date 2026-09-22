// Re-exports every table group. One file per table group (Project Setup
// section 3). Currently just app_user (auth-only slice); the remaining 15
// ERD tables (project, artifact, artifact_version, approval_event,
// logical_item, item_version, artifact_version_item_membership,
// architecture_option, generation_context_ref, semantic_dependency,
// impact_acknowledgement, ai_generation_run, external_operation, external_ref,
// stitch_output) are added incrementally, each with its own A.3-style
// hardening in the migration that creates it (Project Setup section 6).
export * from './app-user';
