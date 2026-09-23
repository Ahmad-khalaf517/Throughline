import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { project } from './project';
import { artifactVersion } from './artifact-version';
import { artifactVersionItemMembership } from './artifact-version-item-membership';
import { externalOperation } from './external-operation';

// ERD section 4.15 / Appendix A. Provenance link to a real GitHub/Jira/Stitch
// object - written on the completion half of the external-write protocol
// (ERD 7.2). Owned by external-operations (Module Boundaries 4.5, layer 4).
export const externalRef = pgTable(
  'external_ref',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    externalKey: text('external_key'),
    externalUrl: text('external_url'),
    sourceArtifactVersionId: uuid('source_artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    sourceItemVersionId: uuid('source_item_version_id'),
    externalOperationId: uuid('external_operation_id')
      .notNull()
      .references(() => externalOperation.id, { onDelete: 'restrict' }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.externalOperationId),
    unique().on(table.provider, table.externalId),
    check('external_ref_provider_check', sql`${table.provider} IN ('github','jira','stitch')`),
    check(
      'external_ref_jira_requires_item_check',
      sql`(${table.provider} = 'jira') = (${table.sourceItemVersionId} IS NOT NULL)`,
    ),
    // Jira: the (version, item) pair must be a real membership row; MATCH
    // SIMPLE skips it when the item is NULL (ERD Appendix A comment).
    foreignKey({
      columns: [table.sourceArtifactVersionId, table.sourceItemVersionId],
      foreignColumns: [
        artifactVersionItemMembership.artifactVersionId,
        artifactVersionItemMembership.itemVersionId,
      ],
    }).onDelete('restrict'),
    // ERD section 5.2: one GitHub repository per project (DB-enforced).
    uniqueIndex('one_github_ref_per_project')
      .on(table.projectId)
      .where(sql`${table.provider} = 'github'`),
    // Traversal / probe indexes (ERD Appendix A "indexes" section).
    index('external_ref_source_item').on(table.sourceItemVersionId),
    index('external_ref_source_version').on(table.sourceArtifactVersionId),
  ],
);
