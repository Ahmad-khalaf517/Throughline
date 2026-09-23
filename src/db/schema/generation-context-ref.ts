import { check, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { artifactVersion } from './artifact-version';

// ERD section 4.10 / Appendix A. Which approved versions the AI saw - audit
// only (dependency-binding reads it read-only; Module Boundaries 4.2 layer
// 1). Owned by artifact-lifecycle (Module Boundaries 4.3). Append-only via
// the generation_context_ref_append_only trigger (ERD A.2 T1). Mandatory
// only for AI-generated drafts (ERD section 3.6, round 7) - a manual
// revision draft has none.
export const generationContextRef = pgTable(
  'generation_context_ref',
  {
    targetArtifactVersionId: uuid('target_artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    sourceArtifactVersionId: uuid('source_artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.targetArtifactVersionId, table.sourceArtifactVersionId] }),
    check(
      'generation_context_ref_target_not_source_check',
      sql`${table.targetArtifactVersionId} <> ${table.sourceArtifactVersionId}`,
    ),
  ],
);
