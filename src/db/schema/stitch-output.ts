import { check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { project } from './project';
import { artifactVersion } from './artifact-version';
import { externalRef } from './external-ref';

// ERD section 4.16 / Appendix A. Stitch prompt/mode + stored asset keys.
// Owned by stitch (Module Boundaries 4.6, layer 5). HTML/screenshot bytes
// live in a private Supabase Storage bucket, read through short-lived signed
// URLs - this table holds only the storage keys and checksums.
export const stitchOutput = pgTable(
  'stitch_output',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    sourceUiRequirementsVersionId: uuid('source_ui_requirements_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    externalRefId: uuid('external_ref_id').references(() => externalRef.id, {
      onDelete: 'restrict',
    }),
    mode: text('mode').notNull(),
    promptText: text('prompt_text').notNull(),
    htmlStorageKey: text('html_storage_key'),
    htmlChecksum: text('html_checksum'),
    screenshotStorageKey: text('screenshot_storage_key'),
    screenshotChecksum: text('screenshot_checksum'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.sourceUiRequirementsVersionId),
    // api <=> has a ref; manual_fallback never has one (on definitive
    // failure the prompt is preserved without an external object - ERD 7.3).
    check('stitch_output_mode_check', sql`${table.mode} IN ('api','manual_fallback')`),
    check(
      'stitch_output_api_requires_ref_check',
      sql`(${table.mode} = 'api') = (${table.externalRefId} IS NOT NULL)`,
    ),
    check(
      'stitch_output_html_pair_check',
      sql`(${table.htmlStorageKey} IS NULL) = (${table.htmlChecksum} IS NULL)`,
    ),
    check(
      'stitch_output_screenshot_pair_check',
      sql`(${table.screenshotStorageKey} IS NULL) = (${table.screenshotChecksum} IS NULL)`,
    ),
  ],
);
