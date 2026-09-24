import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';
import { asAnon } from './support/roles';
import { expectDeniedAsAnon } from './support/assertions';

// ERD Appendix C ("Verification suite", docs/Throughline_ERD.md ~line 1641)
// ported into tests/integration/, per Project Setup section 10 step 9 and
// Jira Plan E1-S5 / SCRUM-21: "Port ERD Appendix C (T1-T43) into
// tests/integration as executable stubs - T14, T27, T28, T34 pass in this
// slice, the rest turn green as their owning slice lands (E2-S9, E3-T1,
// E4-T3 each re-run this same suite, not a copy of it)."
//
// Every T1-T43 acceptance test from ERD section 10 (the canonical table;
// Appendix C's own "rejected writes"/"accepted writes" paragraphs restate
// several of the same ids with slightly different framing - section 10's
// wording is treated as authoritative here) has a real test id below.
// T14/T27/T28/T34 have real, passing assertions - this slice's Definition
// of Done. Everything else is `it.todo`, named with its T## id and the ERD
// scenario/expected result, and cites the future slice whose gate task
// (E2-S9 / E3-T1 / E4-T3) is expected to turn it green - per the mapping
// derived from docs/Throughline_Jira_Plan.md's Epic 2/3/4 tables. T33 and
// T35 cite neither: they belong to E1-S8 and (roughly) E1-S6 respectively,
// not to one of the three lineage/approval/external gates (see their own
// comments below) - naming that plainly rather than force-fitting a
// citation that isn't there.
//
// Harness: one Testcontainers postgres:15-alpine for the whole `integration`
// vitest project (tests/integration/support/global-setup.ts), migrated with
// the frozen drizzle/migrations/0000-0007 in order. Fixture rows use only
// the support/fixtures.ts helpers so every test exercises the real triggers/
// CHECKs, not a shortcut around them (Appendix C's own suite ran the
// canonical flow through the real triggers for the same reason).

let sql: postgres.Sql;

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('ERD Appendix C acceptance suite (T1-T43)', () => {
  // T1 - core promise. R-07@A -> ADR-03@B -> S-12@C -> Jira THR-42.
  // Requirements v3 approved with R-07@D.
  // Expected: ADR-03 direct, S-12 transitive (path R-07@A -> ADR-03@B ->
  // S-12@C), THR-42 impacted via S-12.
  // Turns green with E2-S9 (lineage core gate: impact()/matching/hashing).
  it.todo('T1');

  // T1b - Requirements v4 approved changing only R-20.
  // Expected: same warnings remain (R-07@D is current; S-12 still reaches
  // obsolete A).
  // Turns green with E2-S9.
  it.todo('T1b');

  // T1c - Regenerate Architecture (ADR-03@E -> R-07@D) then Backlog
  // (S-12@F -> ADR-03@E).
  // Expected: E and F not flagged. B and C are historical, not active;
  // THR-42 stays flagged as "created from a superseded Story version".
  // Turns green with E2-S9.
  it.todo('T1c');

  // T2 - Requirements v3 changes only R-07; S-20 depends on R-15@C (reused).
  // Expected: S-20 not flagged.
  // Turns green with E2-S9.
  it.todo('T2');

  // T3 - R-07 removed in v3.
  // Expected: ADR-03@B direct with root A (removed); no tombstone row
  // exists.
  // Turns green with E2-S9.
  it.todo('T3');

  // T4 - Acknowledge S-12/A/against D; then R-07 D -> F. Separately:
  // acknowledge a removal (against NULL), then re-add the same content.
  // Expected: warning returns (acknowledgement no longer matches). The
  // re-added content is a new LogicalItem, so the removal acknowledgement
  // still matches (ERD section 4.12).
  // Turns green with E2-S9.
  it.todo('T4');

  // T5 - Requirements v3 draft holds R-07@D; then reject it.
  // Expected: no warnings while draft; none after rejection.
  // Turns green with E2-S9.
  it.todo('T5');

  // T6 - Backlog draft generated from Requirements v2; Requirements v3
  // changes R-07 before approval.
  // Expected: approval blocked with the blocking rows; override without a
  // note rejected by CHECK; override with a note approves, writes
  // acknowledgements + overrode_stale_check; regenerate passes without
  // override.
  // Turns green with E3-T1 (approval/architecture/generation gate - needs
  // approveVersion, which doesn't exist yet).
  it.todo('T6');

  // T7 - Context changes while generation is in flight.
  // Expected: persisted as rejected / stale_generation_context, no items
  // minted, tokens still recorded.
  // Turns green with E3-T1. (The pre-approval half of this scenario - that
  // a stale-context result never mints items - is exercisable once
  // generation persistence lands at E2-S9, but E3-T1 is where the Jira
  // Plan's own citation places it, so that's what this stub cites; not
  // splitting it into two tests to avoid inventing scope.)
  it.todo('T7');

  // T8 - Architecture v3 approval: ADR-01/02 unchanged, ADR-03 changed,
  // ADR-04 dropped.
  // Expected: ADR-01/02 reuse ItemVersions; ADR-03 gets a new revision
  // under the same LogicalItem; ADR-04 removed and its downstream flagged;
  // no ADR-05..08 minted.
  // Turns green with E3-T1 (needs approveVersion/materialize).
  it.todo('T8');

  // T9 - Select an option from another version; approve Architecture with
  // no selection; approve with 1 or 3 options.
  // Expected: all rejected by FK / guard trigger. Unselected option's ADRs
  // do not exist to be referenced.
  // Turns green with E3-T1.
  it.todo('T9');

  // T10 - Approve Requirements and Backlog concurrently; double-approve one
  // draft.
  // Expected: serialized by the project lock; exactly one approved version
  // per artifact; second gate sees first commit.
  // Turns green with E3-T1 (needs withProjectLock's caller, artifact-
  // lifecycle's approveVersion).
  it.todo('T10');

  // T11 - Lost response on repo/issue creation; unrelated repo with same
  // name; double-click; stale pending.
  // Expected: reconciliation_required; marker-verified adoption only;
  // conflict on foreign repo; one operation row; reconcile before any
  // resend.
  // Turns green with E4-T3 (external integrations gate).
  it.todo('T11');

  // T12 - S-12 changes after THR-42 exists, then export.
  // Expected: Skip / Create New prompt; no update, no silent duplicate.
  // Turns green with E4-T3.
  it.todo('T12');

  // T13 - Architecture re-approved with no ADR change; then with a changed
  // ADR.
  // Expected: repository not flagged; then flagged.
  // Turns green with E4-T3.
  it.todo('T13');

  // T14 - real, passing this slice (E1-S5's Definition of Done).
  describe('T14 - append-only tables / draft-only membership reject their forbidden writes', () => {
    it('T14a: UPDATE item_version raises (item_version_append_only)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const { itemVersionId } = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });

      await expect(
        sql`UPDATE item_version SET revision_number = revision_number + 1 WHERE id = ${itemVersionId}`,
      ).rejects.toThrow(/append-only/i);
    });

    it('T14b: UPDATE semantic_dependency raises (semantic_dependency_append_only)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const upstream = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });
      const downstream = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: downstream.itemVersionId,
        upstreamItemVersionId: upstream.itemVersionId,
      });

      await expect(
        sql`
          UPDATE semantic_dependency SET proposed_by = 'user'
          WHERE downstream_item_version_id = ${downstream.itemVersionId}
            AND upstream_item_version_id = ${upstream.itemVersionId}
        `,
      ).rejects.toThrow(/append-only/i);
    });

    it('T14c: adding membership to an approved (non-draft) artifact_version raises (membership_draft_only)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
      await fx.approveArtifactVersion(sql, versionId);
      const { logicalItemId, itemVersionId } = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });

      await expect(
        fx.createMembership(sql, {
          artifactVersionId: versionId,
          artifactId,
          logicalItemId,
          itemVersionId,
        }),
      ).rejects.toThrow(/frozen/i);
    });
  });

  // T15 - Revert R-07 A -> D -> E (E hash equals A).
  // Expected: E is a new revision; S-12@C (on A) stays flagged until
  // regenerated or acknowledged.
  // Turns green with E2-S9.
  it.todo('T15');

  // T16 - Attempt each cross-project reference (edge, context ref, external
  // ref, operation, acknowledgement, Stitch output).
  // Expected: edge and ItemVersion rejected by the database; the rest
  // rejected by the service layer.
  // Turns green with E4-T3.
  it.todo('T16');

  // T17 - GitHub repo embeds ADR-01/02/03, all tracing to obsolete R-07@A.
  // Expected: one impact() row for the ref with root R-07@A (not one per
  // ADR); direct beats transitive.
  // Turns green with E2-S9.
  it.todo('T17');

  // T18 - Name collision on repo creation, then a different name.
  // Expected: first operation failed (name_taken_by_other); second is a new
  // operation with a new key; a second concurrent GitHub operation is
  // refused.
  // Turns green with E4-T3.
  it.todo('T18');

  // T19 - Change expectedScale (a constraint item) with ADRs citing it and
  // one that does not.
  // Expected: only the citing ADRs (and their descendants) are flagged.
  // Turns green with E2-S9.
  it.todo('T19');

  // T20 - Matcher meets a base ItemVersion with a different
  // semantic_hash_version.
  // Expected: throws; nothing is marked modified.
  // Turns green with E2-S9.
  it.todo('T20');

  // T21 - Regenerate an artifact with no user change (real LLM round trip).
  // Expected: zero new ItemVersions, zero new warnings - "the most
  // important test in the suite" per ERD section 10; must run against a
  // real LLM call, not a mock (throughline-lineage-invariants point 9 /
  // ERD section 14).
  // Turns green with E2-S9.
  it.todo('T21');

  // T22 - Approval gate for a Requirements candidate while an
  // acknowledgement exists whose root is an older Requirement version.
  // Expected: no error (regression test for the v1.1 runtime failure). Must
  // be a Requirements candidate - a Backlog candidate does not reproduce
  // it.
  // Turns green with E2-S9 (the gate query itself) and again with E3-T1
  // (the full approval workflow it's embedded in).
  it.todo('T22');

  // T23 - During that gate, an acknowledgement recorded against the
  // currently-approved version of the root.
  // Expected: acknowledged = false - the candidate supersedes that
  // version, so the acknowledgement stops matching.
  // Turns green with E2-S9 and E3-T1 (see T22).
  it.todo('T23');

  // T24 - Manually edit a draft Story that is bound to an obsolete upstream
  // version; confirm the shown rebinding.
  // Expected: new ItemVersion with proposed_by='user' edges to the current
  // upstream; no longer flagged; without confirmation, nothing is saved.
  // Turns green with E2-S9 (identity/rebinding mechanics) and E3-T1 (the
  // manual-revision workflow it's part of).
  it.todo('T24');

  // T25 - Insert a dependency cycle directly (bypassing the app) and call
  // impact().
  // Expected: terminates; each node reported once.
  // Turns green with E2-S9.
  it.todo('T25');

  // T26 - Export the same Backlog twice with a different configured Jira
  // project in between.
  // Expected: second export creates new operations (target-specific keys);
  // no completed operation is reused for the new target.
  // Turns green with E4-T3.
  it.todo('T26');

  // T27 - real, passing this slice (E1-S5's Definition of Done).
  it('T27: UPDATE architecture_option raises even after approval (architecture_option_append_only)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
    const optionAId = await fx.createArchitectureOption(sql, {
      artifactVersionId: versionId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: versionId, optionKey: 'B' });

    // The trigger fires on every UPDATE unconditionally, so approving first
    // isn't strictly required to prove the raise - done anyway, cheaply, to
    // match the ERD's stated scenario (section 10 T27).
    await fx.approveArtifactVersion(sql, versionId, {
      selectedArchitectureOptionId: optionAId,
    });

    await expect(
      sql`UPDATE architecture_option SET title = 'changed after approval' WHERE id = ${optionAId}`,
    ).rejects.toThrow(/append-only/i);
  });

  // T28 - real, passing this slice (E1-S5's Definition of Done).
  it('T28: INSERT an artifact_version with status=approved raises (artifact_version_insert_guard)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');

    await expect(
      sql`
        INSERT INTO artifact_version (artifact_id, version_number, status, schema_version)
        VALUES (${artifactId}, 1, 'approved', 1)
      `,
    ).rejects.toThrow(/must be created as draft or rejected/i);
  });

  // T29 - Move a Story to a different Epic in a new Backlog version.
  // Expected: no lineage signal - characterization of the accepted
  // limitation (ERD section 11).
  // Turns green with E4-T3.
  it.todo('T29');

  // T30 - Re-approve Architecture with every ADR reused but a different
  // stack.
  // Expected: approval refused by the stack guard.
  // Turns green with E3-T1.
  it.todo('T30');

  // T31 - Architecture regeneration where the model omits
  // previousDisplayKey on an unchanged ADR.
  // Expected: content fallback matches it; the ADR reuses its ItemVersion;
  // no new key, nothing flagged.
  // Turns green with E2-S9.
  it.todo('T31');

  // T32 - Two candidates claim the same previousDisplayKey.
  // Expected: validation error before any insert.
  // Turns green with E2-S9.
  it.todo('T32');

  // T33 - Edit the project brief before and after the first Requirements
  // generation.
  // Expected: before: allowed. After: raises (project_seed_frozen).
  // Does NOT cite E2-S9/E3-T1/E4-T3 - the Jira Plan cites this one to
  // E1-S8, not one of the three lineage/approval/external gates. (The
  // project_seed_frozen trigger this exercises already exists as of E1-S4's
  // migrations, so this is technically passable today - left a stub anyway
  // because this ticket's explicit scope is T14/T27/T28/T34 only; not
  // widening it.)
  it.todo('T33');

  // T34 - real, passing this slice (E1-S5's Definition of Done).
  //
  // Role/ownership approach: migrations are applied as the container's
  // default user, a real Postgres superuser (the fallback Project Setup /
  // this ticket's brief explicitly allow for T14/T27/T28, which test
  // triggers/CHECKs that fire regardless of role). For T34 specifically,
  // every anon-role assertion runs with the session's role switched via
  // `SET LOCAL ROLE anon` inside its own transaction (tests/integration/
  // support/roles.ts `asAnon`, tests/integration/support/assertions.ts
  // `expectDeniedAsAnon`) - a superuser may SET
  // ROLE to any role without membership and, per the PostgreSQL docs, loses
  // its superuser/BYPASSRLS privileges for the duration, so this exercises
  // the real REVOKE+RLS hardening, not a superuser's (meaningless) view of
  // it. `createSupabaseRoles` (support/roles.ts) also reproduces Supabase's
  // default-privilege behaviour (`ALTER DEFAULT PRIVILEGES ... TO anon,
  // authenticated`) before the migrations run, so 0001/0006's REVOKE
  // statements have real grants to revoke on this vanilla container - see
  // that file's comment for why that matters (without it, the table-level
  // denials would pass locally for the wrong reason, since a vanilla
  // Postgres never grants PUBLIC/anon anything on a table by default in the
  // first place - unlike functions, where EXECUTE *is* granted to PUBLIC by
  // default, which is why the impact() denial below is the one sub-check
  // that's meaningful on this container without that reproduction, and the
  // accidental-grant sub-check is meaningful regardless).
  describe('T34 - Supabase anon is denied read/write/EXECUTE everywhere; RLS still blocks an accidental grant', () => {
    // Every table Appendix A.3 enables RLS on (drizzle/migrations/0001,
    // 0006) - the complete 16-table ERD model.
    const HARDENED_TABLES = [
      'app_user',
      'project',
      'artifact',
      'artifact_version',
      'architecture_option',
      'approval_event',
      'logical_item',
      'item_version',
      'artifact_version_item_membership',
      'generation_context_ref',
      'semantic_dependency',
      'external_operation',
      'external_ref',
      'impact_acknowledgement',
      'ai_generation_run',
      'stitch_output',
    ] as const;

    it('T34a: anon SELECT is denied on every one of the 16 hardened tables', async () => {
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`SELECT 1 FROM "${table}" LIMIT 1`));
      }
    });

    it('T34b: anon INSERT is denied on every one of the 16 hardened tables', async () => {
      // DEFAULT VALUES needs no knowledge of a table's columns and, because
      // Postgres checks table-level privileges before row constraints, a
      // denied INSERT never gets far enough to also trip a NOT NULL
      // violation - the error is permission denied, full stop, even for
      // tables with no nullable/defaulted columns at all.
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`INSERT INTO "${table}" DEFAULT VALUES`));
      }
    });

    it('T34c: anon DELETE is denied on every one of the 16 hardened tables', async () => {
      // WHERE false needs no knowledge of a table's columns either, and
      // privilege checks don't depend on how many rows would actually
      // match.
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`DELETE FROM "${table}" WHERE false`));
      }
    });

    it('T34d: anon UPDATE is denied (spot check: project, app_user)', async () => {
      await expectDeniedAsAnon(sql, (tx) =>
        tx.unsafe(`UPDATE project SET name = name WHERE false`),
      );
      await expectDeniedAsAnon(sql, (tx) =>
        tx.unsafe(`UPDATE app_user SET email = email WHERE false`),
      );
    });

    it('T34e: anon calling impact() is denied (EXECUTE revoked from PUBLIC/anon/authenticated)', async () => {
      // Any well-formed uuid does - EXECUTE is denied before the function
      // body (and therefore any lookup against p_project_id) ever runs.
      const someProjectId = randomUUID();
      await expectDeniedAsAnon(sql, (tx) =>
        tx.unsafe(`SELECT * FROM impact('${someProjectId}'::uuid)`),
      );
    });

    it('T34f: an accidental GRANT still yields zero rows under RLS (no policies)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'T34 accidental grant' });

      await sql.unsafe('GRANT SELECT ON project TO anon');
      try {
        const rows = await asAnon(
          sql,
          (tx) => tx<{ id: string }[]>`SELECT id FROM project WHERE id = ${projectId}`,
        );
        // No error this time (anon *can* read the table now) - but RLS is
        // enabled with no policies, so the row set is still empty. This is
        // the two-layer defense Appendix A.3's own comment describes: layer
        // 1 (REVOKE) stops the Data API outright; layer 2 (RLS, no
        // policies) means even a later accidental GRANT like this one still
        // exposes zero rows.
        expect(rows).toHaveLength(0);
      } finally {
        // Never let the accidental grant leak into a later test.
        await sql.unsafe('REVOKE SELECT ON project FROM anon');
      }

      // And the row genuinely exists (for the owner) - proving RLS hid it
      // from anon, rather than the table just being empty.
      const asOwner = await sql<{ id: string }[]>`SELECT id FROM project WHERE id = ${projectId}`;
      expect(asOwner).toHaveLength(1);
    });
  });

  // T35 - Delete a Supabase user and re-create them with the same email;
  // log in twice.
  // Expected: a new app_user row with the new id; the old row and its
  // history remain; the login upsert is idempotent.
  // Does NOT cite E2-S9/E3-T1/E4-T3 - it needs the `auth` module
  // (getVerifiedUser/upsertAppUser, roughly E1-S6) and a live Supabase Auth
  // user lifecycle, not a Postgres container. Project Setup section 10 step
  // 10 is where this actually gets verified.
  it.todo('T35');

  // T36 - Insert a version directly as rejected with a non-stale reason;
  // move a draft to rejected claiming stale_generation_context.
  // Expected: both raise.
  // Turns green with E4-T3.
  //
  // (Both sub-cases are actually exercisable against the trigger today -
  // artifact_version_insert_guard and artifact_version_guard both already
  // exist (E1-S4) - but the Jira Plan's own mapping places T36 at E4-T3, so
  // this stays a stub rather than force-passing it out of citation order.)
  it.todo('T36');

  // T37 - stitch_output with mode='manual_fallback' and a ref; with
  // mode='api' and none.
  // Expected: both raise.
  // Turns green with E4-T3.
  it.todo('T37');

  // T38 - Update an external_operation while writing an old updated_at.
  // Expected: the stored updated_at is the time of the update.
  // Turns green with E4-T3.
  it.todo('T38');

  // T39 - Create a Jira operation with no item, or with an item that is not
  // a member of its Backlog version; create any operation with no source
  // version.
  // Expected: all raise at step 1 - before any provider call.
  // Turns green with E4-T3.
  it.todo('T39');

  // T40 - Open a manual revision of approved Requirements, edit only R-07,
  // approve.
  // Expected: the draft initially shares every ItemVersion with the
  // approved version and has no context refs; after approval exactly one
  // new ItemVersion exists; only R-07's dependency chain is flagged.
  // Turns green with E3-T1 (needs the manual-revision path and
  // approveVersion, which don't exist yet).
  it.todo('T40');

  // T41 - Edit Epic E-01's title, re-approve the Backlog, re-export to
  // Jira; choose Skip for E-01.
  // Expected: the Skip / Create New prompt appears for the Epic; no second
  // Jira Epic is created; its Stories are parented to the existing Jira
  // Epic of E-01.
  // Turns green with E4-T3.
  it.todo('T41');

  // T42 - Preview a Jira export whose Stories include a flagged Story.
  // Expected: the preview lists the impact rows and requires an explicit
  // confirmation; the resulting ref is flagged immediately.
  // Turns green with E4-T3.
  it.todo('T42');

  // T43 - Try to generate UI Requirements before Architecture is approved,
  // and a Backlog before UI Requirements is approved.
  // Expected: both refused (TR FR-080).
  // Turns green with E2-S9.
  it.todo('T43');
});
