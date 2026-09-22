---
name: throughline-lineage-invariants
description: Load when writing or reviewing code in src/lineage/** (identity, dependency-binding, impact), src/artifact-lifecycle/**, src/artifact-types/**, or anything touching matching, hashing, semantic projection, freshness, staleness, impact, warnings, acknowledgement, approval, revision, regeneration, or withProjectLock. Also load before writing a test that cites an ERD T## id, or when a diff changes artifact_version, item_version, logical_item, semantic_dependency, impact_acknowledgement, or generation_context_ref.
---

# Throughline lineage invariants

You are working on the highest-risk part of an 8-day capstone (ERD section 14 names Epic 2 - lineage core - as the single highest-risk epic in the whole build). These rules are frozen. They come from `docs/Throughline_Technical_Requirements_Lineage_Invariants.md` sections 18-27 and `docs/Throughline_ERD.md`. Do not re-derive them from first principles and do not "improve" them mid-implementation - if one seems wrong, say so and cite the section, don't silently code around it.

**If you are about to write to `artifact_version`, `item_version`, `logical_item`, `semantic_dependency`, or `impact_acknowledgement` from outside `src/artifact-lifecycle/`, `src/lineage/identity/`, or `src/lineage/impact/` respectively - stop.** That is a Module Boundaries violation, not a lineage one; load `throughline-module-boundaries` too.

## The five things a generic code reviewer will not catch here

1. **A version is born only as `draft`, or as `rejected` with `status_reason = 'stale_generation_context'`.** No other creation path exists. `status` is one of exactly `draft` / `approved` / `superseded` / `rejected` (ERD CHECK, line ~1079) - there is no `stale` status. Staleness/impact is a *separate, computed-on-read* dimension (INV-020), never a stored field, and never conflated with `status` in code, UI, or a comment.

2. **Only `artifact-lifecycle` calls `withProjectLock`.** Every write that changes `artifact_version.status`, allocates a `version_number` / `revision_number` / `display_key`, or mints an `item_version` must happen inside that lock, from that module. `identity`'s functions receive an open `tx` from whoever called them - they never open their own transaction or their own lock (Module Boundaries section 6).

3. **Model output is untrusted data, structurally.** The model may propose a `previousDisplayKey` (a human-readable hint, never a database id) and a semantic mapping. Code validates: the key belongs to an unclaimed member of the comparison base, of the same item type; two outputs claiming the same key is a validation error *before any insert* (INV-024's "no items created" pattern, T32). The model never supplies an identifier, a status, or a query (NFR-005).

4. **Binding scope is exactly what the model was shown, never re-bound later.** `generationContextRefs` (what the model saw) and `dependencyRefs` (what an item semantically depends on) are different concepts stored separately (TR section 23). If the base version or any bound upstream item is no longer current by the time the result arrives, the whole result is persisted as `rejected` / `stale_generation_context` - raw output and context kept for audit, **no items minted** - not silently rebound to what's current now (INV-006).

5. **Staleness traversal starts from changed/removed items relative to *current* state, not from "what changed at the last approval."** One impact engine (`impact()`), evaluated fresh on every read, is the only source of truth for the warning panel, the dependency view, the approval gate, and external-write drift (INV-025). Nothing computes impact any other way, anywhere.

## The match/hash/reuse pipeline (INV-010 through INV-016, section 24)

When an artifact is regenerated, in order:

1. Comparison base = the artifact's **current authoritative approved** version, captured at draft creation. Never a rejected or inactive draft (INV-013, section 24 preamble).
2. Base items go to the model keyed by **display key only**, never a database id.
3. Code validates each proposed `previousDisplayKey`: must name an unclaimed member of the base, of the matching item type. Two outputs claiming the same key = validation error, nothing inserted (T32).
4. Code computes the **semantic projection** for the item type (TR section 22's field table) and hashes it (`semanticHash = SHA-256(canonicalJSON(projection))`). This is the reuse decision - the model's own unchanged/modified label is a hint only, never trusted (section 22, closing line).
5. Unchanged -> reuse the existing `item_version` (INV-010). Modified -> same `logical_item_id`, new `item_version_id` (INV-011). New -> both new (INV-012). Present in the old base but absent from the new approved version -> removed (INV-013), and removed items are valid traversal roots.
6. **For dependent item types (Architecture Decision, UI Requirement, Story), the sorted exact upstream `item_version` ids are part of the semantic projection** (INV-016). Skip this and a Story regenerated against a changed Requirement silently reuses its stale `item_version` forever - the warning can never clear. A **content-only** projection (same fields, no upstream ids) exists separately, used *only* for identity fallback matching (INV-014, next).
7. If an output has no valid `previousDisplayKey`: compare its content-only projection against the still-unclaimed base items of the same type. Exactly one identical match = that item. Zero or several = new (INV-014, T31). One missed hint from the model must never mint a spurious new identity.
8. The projection/hash rule is frozen at version 1. Code refuses to compare against an `item_version` hashed under a different rule version rather than silently marking everything modified (section 22, T20).
9. Regeneration must be **stable**: aggressive normalization (case, whitespace, sorted criteria), base items supplied verbatim, low temperature. There is a dedicated no-change-regeneration test for this (section 44 item 25) - if you touch the prompt or the projection, that test is the one to re-run, and per ERD section 14 it (as T21) must pass against a **real LLM call**, not a mock, before any other Epic-2 test is considered meaningful.

## Dependency edges are immutable (INV-015)

Recorded once, at the moment the downstream `item_version` is created. Never added, changed, or removed afterward - "changing what an item depends on" always means creating a new `item_version`. Both ends same project, DB-enforced.

## Impact and acknowledgement (section 25-26)

- **Direct** = depends on a changed/removed source directly. **Transitive** = depends on an impacted item through one or more edges. Both are reported; never flatten into one list (INV-022). If an item is both, report direct.
- Traversal never passes through a historical (superseded) intermediate - it names the *nearest current-but-obsolete* item as the cause, so repair proceeds top-down (INV-022 closing rule, T1c).
- Every warning must be **inspectable**: the actual dependency path, not just a boolean (INV-023). Example shape: `R-07 changed -> ADR-03 depends on R-07 -> S-12 depends on ADR-03 -> Jira THR-42 created from S-12`.
- Warning copy is conservative: "potentially affected," "review recommended," "based on a superseded source" - never a flat claim that something is wrong (INV-024). This is a wording rule that belongs in the copy, not just the logic.
- An acknowledgement is specific to **(subject, obsolete root, the root's current version at ack time)**. It stops matching the moment that root's logical item moves again, and never suppresses a *different* cause (INV-026). Acknowledgements are append-only - never updated or deleted.
- The approval gate evaluates the candidate **as if it replaced** its artifact's current approved version - never "in addition to" it (INV-025). This is exactly the bug class T22/T23 exist to catch (a real v1.1 runtime failure from a scalar subquery matching two "current" rows at once) - if you're touching the gate query, read ERD section 6 before changing it.

## The approval workflow rules (FR-080 through FR-085)

- **Generation order is enforced, not advisory**: Architecture needs approved Requirements; UI Requirements needs approved Requirements + Architecture; Backlog needs all three approved (T43).
- **Two revision paths, and they must stay distinguishable**: AI revision (regenerate with feedback, unchanged items must come back verbatim so `item_version`s are reused) vs. **manual revision** (reuses *every* `item_version` unchanged, zero model calls, then the user edits individual items). The controlled-change capstone test (BRD 10.3) depends on manual revision being a *pure* one-item change with no model noise mixed in - do not let an AI call sneak into that path.
- **Manual edit rebinds visibly**: editing an item creates a new `item_version`; its upstream refs rebind to the *current* version of each upstream item; the user is shown exactly what changes ("S-12 will now depend on R-07 v3 instead of v2") and must confirm; refused if an upstream item was removed (FR-082).
- **The approval gate blocks on any flagged, unacknowledged item at any depth** (FR-083) - and the override (FR-084) does not bypass the gate, it satisfies it: recompute the warnings inside the approval transaction, write one cause-specific acknowledgement per warning, require a non-empty note, mark the event as an override.
- **Every external-write preview (GitHub/Jira/Stitch) shows current impact for the items it would create from**, and creating from a flagged item is allowed with explicit confirmation - never silently blocked, never silently allowed without the warning shown (FR-085).

## Before you write a test

Cite the ERD test id(s) it satisfies (T1-T43, ERD section 13/appendix, and the summary table around line 873). If what you're implementing has no test id and no INV/FR id behind it, it does not belong in P0 - flag it rather than inventing scope (Jira Plan section 1's rule, TR Appendix B).
