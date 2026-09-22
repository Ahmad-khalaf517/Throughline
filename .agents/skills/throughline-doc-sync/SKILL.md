---
name: throughline-doc-sync
description: Load before editing any file under docs/ (ERD, BRD, Technical Requirements, Module Boundaries, API Contracts, Jira Plan), before adding or renumbering a BO/BR/FR/NFR/INV/T## identifier, before a schema or DDL change, or when asked to "update the ERD", "add a requirement", "change an invariant", or "verify the schema". Also load when a change to one of these documents might affect another one downstream.
---

# Throughline documentation sync

Source of this rule: your own standing project memory (`erd-single-living-doc`) plus the traceability chain the BRD itself defines (BRD section 3.1). This skill exists because Throughline's own thesis - that a changed upstream decision should identify its specific downstream dependents, not trigger a vague "everything is stale" - applies to its own six-document planning chain just as much as to the product's lineage graph. Treat this skill as dogfooding your own product's rule on your own docs.

## The chain, and which direction edits flow

```
BRD (BO-xxx, BR-xxx)
  -> Technical Requirements & Lineage Invariants (FR-xxx, NFR-xxx, INV-xxx)
    -> ERD/Data Model (tables, triggers, impact(), T## tests)
      -> Module Boundaries (module map, table ownership, layer graph)
        -> API Contracts (routes)
          -> Jira Plan (Epics/Stories, cited FR/INV/T## ids)
            -> Implementation
```

**An edit anywhere puts every document to its right at risk.** The edit is not done until each of those has been checked - not necessarily changed, but checked - for whether it still agrees with the new decision. Editing the ERD without checking whether Module Boundaries' table-ownership matrix or the Jira Plan's cited test ids still hold is exactly the "disconnected planning artifact" failure the BRD (section 2, problem 1) describes as the reason this whole project exists.

## Identifier namespaces are separate - do not mix them

- `BO-xxx` - Business Objectives (BRD only)
- `BR-xxx` - Business Requirements (BRD only)
- `FR-xxx` / `NFR-xxx` - functional / non-functional requirements (Technical Requirements doc)
- `INV-xxx` - lineage/workflow invariants (Technical Requirements doc)
- `T##` - ERD acceptance tests (ERD appendix)

This separation exists specifically so references in Jira tickets, commits, and AI-agent instructions are unambiguous (BRD section 3.1, closing line). Never invent a new prefix, never renumber an existing id to "make room," never reuse a retired number.

## The ERD is one living document

`docs/Throughline_ERD.md` is updated **in place** after every decision that touches it - never forked into a `_v2` file, never duplicated. It already carries its own version number and a status line recording what changed in the last round (see the file's own header). When you touch it:

1. Bump the version number in the header.
2. Update the status line to say what changed and why, in one sentence - this doc's own history already does this well; match that style.
3. If the change touches Appendix A (DDL) or Appendix C (the test suite), **execute the SQL before calling it verified** - a schema change is not done because the markdown looks right, it's done because it ran. Use the Supabase MCP tools (`execute_sql` / `apply_migration`) or `drizzle-kit generate` + the Appendix C suite, and say which one you used and what it returned.
4. If a decision is genuinely frozen (the header says "FROZEN"), do not casually reopen it. A frozen decision changes only with an explicit, stated reason recorded in the same edit - not silently "while I was in there."

## Checklist for a change that starts in the BRD or Technical Requirements

- [ ] Does a new/changed `BR-xxx` need a new/changed `FR-xxx`/`NFR-xxx`/`INV-xxx`? Add it with the right prefix and cite the `BR-xxx` it serves (the BRD's own requirements table does this - match the pattern).
- [ ] Does it change a table, a trigger, or `impact()`'s behavior? Update the ERD **in place**, bump its version, and re-run Appendix C.
- [ ] Does it change which module owns a table, or the layer a module sits in? Update Module Boundaries' module map (section 3) and table-ownership matrix (section 5).
- [ ] Does it change a request/response shape? Update the matching route in API Contracts.
- [ ] Does it add, remove, or change the meaning of an ERD test id or FR/INV id? Find every Jira Plan story that cites it (`grep` the id across `docs/Throughline_Jira_Plan.md`) and update or flag each one - do not leave a story citing a test id that no longer means what the story assumes.
- [ ] Is there a new story implied, or an old one now uncited? A Jira Plan story with no citation back to one of the four parent documents does not belong in P0 (Jira Plan section header, TR Appendix B guidance) - flag it instead of inventing it.

## What this skill does not authorize

This skill is about keeping the documents mutually consistent. It does not authorize reopening a scope decision (BRD section 9's out-of-scope list, the ERD's FROZEN markers, Project Setup's D-1..D-4) on your own judgment - those changes go through the same explicit, stated-reason process as any other frozen decision, and the budget math in Jira Plan section 1.6 means a casual scope addition is not free.
