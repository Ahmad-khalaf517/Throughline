import { randomBytes, randomUUID } from 'node:crypto';
import type { JsonValue, QueryExecutor } from './types';

// Minimal, valid fixture rows for exercising the Appendix A triggers/CHECKs
// under test - not a general-purpose factory library. Every field a CHECK
// constraint cares about (drizzle/migrations/0000_app_user.sql,
// 0002_remaining_tables.sql) is covered; anything else is a fixed, boring
// default so each test only has to override what it's actually testing.

type ItemTypePrefix = 'R' | 'ADR' | 'UI' | 'E' | 'S';

// logical_item_display_key_format_check (0002) requires >= 2 digits per
// item_type's prefix. project_id+display_key is the actual unique scope,
// but a single run-wide counter keeps every generated key trivially unique
// without each test having to track "which project used R-01 already".
const displayKeyCounters = new Map<ItemTypePrefix, number>();

export function nextDisplayKey(prefix: ItemTypePrefix): string {
  const n = (displayKeyCounters.get(prefix) ?? 0) + 1;
  displayKeyCounters.set(prefix, n);
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

// item_version_semantic_hash_check: ^[0-9a-f]{64}$.
export function randomSemanticHash(): string {
  return randomBytes(32).toString('hex');
}

export async function createAppUser(
  sql: QueryExecutor,
  overrides: { email?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO app_user (id, email) VALUES (${id}, ${overrides.email ?? `${id}@example.test`})
  `;
  return id;
}

export async function createProject(
  sql: QueryExecutor,
  ownerUserId: string,
  overrides: { name?: string; brief?: string } = {},
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO project (owner_user_id, name, brief)
    VALUES (
      ${ownerUserId},
      ${overrides.name ?? 'Test project'},
      ${overrides.brief ?? 'A test project brief.'}
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

// Convenience: a fresh app_user + project pair, isolated from every other
// test's fixtures (most Appendix C tests below want their own project
// rather than sharing one, so a trigger firing in one test can't be
// confused with unique-constraint noise from another).
export async function createProjectWithOwner(
  sql: QueryExecutor,
  overrides: { name?: string; brief?: string } = {},
): Promise<{ userId: string; projectId: string }> {
  const userId = await createAppUser(sql);
  const projectId = await createProject(sql, userId, overrides);
  return { userId, projectId };
}

export type ArtifactType = 'requirements' | 'architecture' | 'ui_requirements' | 'backlog';

export async function createArtifact(
  sql: QueryExecutor,
  projectId: string,
  type: ArtifactType,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO artifact (project_id, type) VALUES (${projectId}, ${type}) RETURNING id
  `;
  return rows[0]!.id;
}

// artifact_version_insert_guard (0004) only allows birth as draft or
// rejected/stale_generation_context - this helper only ever inserts draft,
// which is what every ported test needs to then approve/mutate/reject.
export async function createDraftArtifactVersion(
  sql: QueryExecutor,
  artifactId: string,
  overrides: { versionNumber?: number; schemaVersion?: number; payload?: JsonValue } = {},
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO artifact_version (artifact_id, version_number, status, schema_version, payload)
    VALUES (
      ${artifactId},
      ${overrides.versionNumber ?? 1},
      'draft',
      ${overrides.schemaVersion ?? 1},
      ${sql.json(overrides.payload ?? {})}
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

// artifact_version_guard (0004) allows draft -> approved unconditionally for
// non-architecture artifacts; architecture additionally requires exactly 2
// architecture_option rows and a selected_architecture_option_id set in the
// SAME update (selecting an option is only legal while transitioning
// draft -> approved). Both are always required in combination.
export async function approveArtifactVersion(
  sql: QueryExecutor,
  versionId: string,
  overrides: { selectedArchitectureOptionId?: string } = {},
): Promise<void> {
  if (overrides.selectedArchitectureOptionId) {
    await sql`
      UPDATE artifact_version
      SET status = 'approved',
          selected_architecture_option_id = ${overrides.selectedArchitectureOptionId}
      WHERE id = ${versionId}
    `;
  } else {
    await sql`UPDATE artifact_version SET status = 'approved' WHERE id = ${versionId}`;
  }
}

export type ItemType =
  'requirement' | 'architecture_decision' | 'ui_requirement' | 'epic' | 'story';

const DISPLAY_KEY_PREFIX: Record<ItemType, ItemTypePrefix> = {
  requirement: 'R',
  architecture_decision: 'ADR',
  ui_requirement: 'UI',
  epic: 'E',
  story: 'S',
};

export async function createLogicalItem(
  sql: QueryExecutor,
  args: { projectId: string; artifactId: string; itemType: ItemType; displayKey?: string },
): Promise<{ id: string; displayKey: string }> {
  const displayKey = args.displayKey ?? nextDisplayKey(DISPLAY_KEY_PREFIX[args.itemType]);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO logical_item (project_id, artifact_id, item_type, display_key)
    VALUES (${args.projectId}, ${args.artifactId}, ${args.itemType}, ${displayKey})
    RETURNING id
  `;
  return { id: rows[0]!.id, displayKey };
}

export async function createItemVersion(
  sql: QueryExecutor,
  args: {
    projectId: string;
    logicalItemId: string;
    revisionNumber?: number;
    payload?: JsonValue;
    semanticHash?: string;
    semanticHashVersion?: number;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO item_version
      (project_id, logical_item_id, revision_number, payload, semantic_hash, semantic_hash_version)
    VALUES (
      ${args.projectId},
      ${args.logicalItemId},
      ${args.revisionNumber ?? 1},
      ${sql.json(args.payload ?? {})},
      ${args.semanticHash ?? randomSemanticHash()},
      ${args.semanticHashVersion ?? 1}
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

// Bundles createLogicalItem + createItemVersion, the pairing almost every
// test actually wants (a "current" item at revision 1).
export async function createLogicalItemWithVersion(
  sql: QueryExecutor,
  args: { projectId: string; artifactId: string; itemType: ItemType; displayKey?: string },
): Promise<{ logicalItemId: string; displayKey: string; itemVersionId: string }> {
  const { id: logicalItemId, displayKey } = await createLogicalItem(sql, args);
  const itemVersionId = await createItemVersion(sql, {
    projectId: args.projectId,
    logicalItemId,
  });
  return { logicalItemId, displayKey, itemVersionId };
}

export async function createMembership(
  sql: QueryExecutor,
  args: {
    artifactVersionId: string;
    artifactId: string;
    logicalItemId: string;
    itemVersionId: string;
    parentLogicalItemId?: string | null;
    position?: number | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO artifact_version_item_membership
      (artifact_version_id, artifact_id, logical_item_id, item_version_id, parent_logical_item_id, position)
    VALUES (
      ${args.artifactVersionId},
      ${args.artifactId},
      ${args.logicalItemId},
      ${args.itemVersionId},
      ${args.parentLogicalItemId ?? null},
      ${args.position ?? null}
    )
  `;
}

export async function createArchitectureOption(
  sql: QueryExecutor,
  args: {
    artifactVersionId: string;
    optionKey: 'A' | 'B';
    title?: string;
    summary?: string;
    stack?: JsonValue;
    candidateDecisions?: JsonValue;
    tradeoffs?: JsonValue;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO architecture_option
      (artifact_version_id, option_key, title, summary, stack, candidate_decisions, tradeoffs)
    VALUES (
      ${args.artifactVersionId},
      ${args.optionKey},
      ${args.title ?? `Option ${args.optionKey}`},
      ${args.summary ?? 'A summary.'},
      ${sql.json(args.stack ?? {})},
      ${sql.json(args.candidateDecisions ?? [])},
      ${sql.json(args.tradeoffs ?? {})}
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

export async function createSemanticDependency(
  sql: QueryExecutor,
  args: {
    projectId: string;
    downstreamItemVersionId: string;
    upstreamItemVersionId: string;
    proposedBy?: 'ai' | 'system' | 'user';
  },
): Promise<void> {
  await sql`
    INSERT INTO semantic_dependency
      (project_id, downstream_item_version_id, upstream_item_version_id, proposed_by)
    VALUES (
      ${args.projectId},
      ${args.downstreamItemVersionId},
      ${args.upstreamItemVersionId},
      ${args.proposedBy ?? 'ai'}
    )
  `;
}
