import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './app-user';

// ERD section 4.17 / Appendix A.5 (round 14). One row per (user, provider):
// the user's OWN GitHub, Jira or Stitch credential. Belongs to a user, not a
// project, and is MUTABLE (tokens refresh, status changes) - so none of the
// append-only / frozen-row triggers apply; only touch_updated_at (migration
// 0010, not expressible here). Owned by the `connections` module (Module
// Boundaries section 5), which is its sole writer.
//
// The two shape regexes are CHECKs on purpose: a code path that forgot to
// encrypt fails at INSERT/UPDATE instead of persisting a secret (T45). This
// is a SHAPE check, not proof of encryption - the encryption is [APP].

export const providerConnection = pgTable(
  'provider_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    // Provider's stable id for the account (not a secret).
    externalAccountId: text('external_account_id').notNull(),
    displayName: text('display_name').notNull(),
    // 'v1:<iv>:<tag>:<ciphertext>' (base64url), or the tombstone 'revoked'.
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    scopes: text('scopes').notNull().default(''),
    // Whitelisted, non-secret: github login; jira cloudId/siteUrl/siteName.
    providerMeta: jsonb('provider_meta')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('active'),
    keyVersion: integer('key_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Maintained by the touch_updated_at trigger (migration 0010), never by
    // callers; it feeds the refresh-expiry decision.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.userId, table.provider),
    // Target of external_operation's composite (connection_id, provider) FK.
    unique().on(table.id, table.provider),
    check(
      'provider_connection_provider_check',
      sql`${table.provider} IN ('github','jira','stitch')`,
    ),
    check(
      'provider_connection_status_check',
      sql`${table.status} IN ('active','needs_reauth','revoked')`,
    ),
    check('provider_connection_key_version_check', sql`${table.keyVersion} > 0`),
    check(
      'provider_connection_meta_object_check',
      sql`jsonb_typeof(${table.providerMeta}) = 'object'`,
    ),
    // Top-level only; nested keys are not inspected (the app whitelist is the real control).
    check(
      'provider_connection_meta_no_secret_keys_check',
      sql`NOT (${table.providerMeta} ?| ARRAY['access_token','refresh_token','token','api_key','apiKey','secret','client_secret','password'])`,
    ),
    check(
      'provider_connection_token_shape_check',
      sql`(${table.status} = 'revoked' AND ${table.accessTokenEnc} = 'revoked' AND ${table.refreshTokenEnc} IS NULL AND ${table.expiresAt} IS NULL)
        OR
        (${table.status} <> 'revoked'
         AND ${table.accessTokenEnc} ~ '^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
         AND split_part(${table.accessTokenEnc}, ':', 1) = 'v' || ${table.keyVersion}::text
         AND (${table.refreshTokenEnc} IS NULL
              OR (${table.refreshTokenEnc} ~ '^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
                  AND split_part(${table.refreshTokenEnc}, ':', 1) = 'v' || ${table.keyVersion}::text)))`,
    ),
  ],
);
