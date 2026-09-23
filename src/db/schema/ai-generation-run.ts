import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { project } from './project';
import { artifactVersion } from './artifact-version';

// ERD section 4.13 / Appendix A. Per-call LLM usage/cost/failure log (NFR-004
// reproducibility metadata). Owned by ai-client (Module Boundaries 4.1,
// layer 0) - the only module that calls the LLM provider.
//
// artifact_version_id is nullable: a schema-validation failure is still
// logged as a failed run even though no version exists yet to attach it to
// (Module Boundaries 4.1 rule; TR section 33).
export const aiGenerationRun = pgTable(
  'ai_generation_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    artifactVersionId: uuid('artifact_version_id').references(() => artifactVersion.id, {
      onDelete: 'restrict',
    }),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'ai_generation_run_purpose_check',
      sql`${table.purpose} IN ('generation','semantic_mapping','revision','quality_check')`,
    ),
    check('ai_generation_run_status_check', sql`${table.status} IN ('succeeded','failed')`),
    index('ai_generation_run_version').on(table.artifactVersionId),
    index('ai_generation_run_project').on(table.projectId),
  ],
);
