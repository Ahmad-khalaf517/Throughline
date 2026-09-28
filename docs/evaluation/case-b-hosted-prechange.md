# Case B: hosted Throughline, pre-change snapshot and scoring

**Project:** [E6-S5 B — Small bookstore inventory](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9). **Reviewer:** the same Codex agent that wrote the preregistration and proxy; it knew the answer key. **Planning timer:** 2026-09-28 11:37:19–11:42:59 UTC, 5m 40s elapsed with browser and generation waits, no interruption subtracted. UI Requirements generation/approval was an enforced prerequisite to Backlog and is included in the clock.

Raw approved snapshots: [Requirements v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/eae269e3-a382-4500-8cf2-2d936d44cf34) (5 items); [Architecture v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/a8a69535-3eef-464a-8ba7-18f1635c3c63) (Option A transactional web monolith, 4 ADRs); [UI Requirements v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/da4f1ac1-c8ea-4b59-84bb-7d6599fa2b02) (5 UI items); [Backlog v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/c544a1b6-a3ef-402e-9e36-fe65210b2bcc) (4 epics, 9 stories). These are the inspectable first output versions, with item keys and content transcribed below before mutation. Requirements quality gate raised an unresolved question about purchase-order information. Architecture candidates supplied no trade-offs. Backlog quality gate reported 0 findings.

## Fixed-checklist scoring before change

| Measure | AI-assisted template proxy | Hosted Throughline | Item-level reason |
|---|---:|---:|---|
| Requirements completeness | 8/8 | 8/8 | R-01 bundles catalog, receipt, sale, on-hand and negative-stock guard; R-02 covers correction/audit; R-03 threshold/list; R-04 proposed order. |
| Functional Requirement AC complete | 8/8 | 2/4 | R-03 gives list inclusion/exclusion around threshold; R-04 gates `sent` on manager action. R-01 never specifies successful sale decrement; R-02 never specifies that a correction sets on-hand to the counted value. R-05 is a constraint, excluded. |
| Story AC complete | 8/8 | 5/9 | S-01, S-02, S-03, S-06, S-09 have observable outcomes for their stated work. S-04 lacks successful sale decrement; S-05 lacks correction's new balance; S-07 lacks exclusion above threshold; S-08 lacks an explicit unsent draft outcome. |
| Valid story-to-Requirement links | 8/8 | 9/9 | All hosted S-01–S-09 cite resolvable, semantically related R IDs; no missing/invalid link warning surfaced. |
| Valid ADR-to-Requirement links | 4/4 | 4/4 | ADR-01→R-01/R-03/R-04/R-05 (broad), ADR-02→R-01/R-02, ADR-03→R-03/R-04/R-05, ADR-04→R-05. |
| Must-concept backlog coverage | 8/8 implemented | 8/8 implemented | See concept mapping below; no explicitly or silently uncovered must concept. |

### Concept and story mapping

| Fixed B concept | Hosted R | Hosted S | Proxy R/S |
|---|---|---|---|
| Title/ISBN | R-01 | S-01 | R-01/S-01 |
| Receipt | R-01 | S-04 | R-02/S-02 |
| Sale | R-01 | S-04 | R-03/S-03 |
| On-hand view | R-01 | S-02 | R-04/S-04 |
| Count correction/reason | R-02 | S-05 | R-05/S-05 |
| Per-title threshold/low-stock list | R-03 | S-06, S-07 | R-06/S-06 |
| Manager-reviewed draft order | R-04 | S-08, S-09 | R-07/S-07 |
| Negative-stock guard/quantity audit | R-01, R-02 | S-04, S-05 | R-08/S-03, S-08 |

### Frozen hosted item mapping for shop-wide threshold change

The stimulus is the preregistered change to **one shop-wide threshold of 5**, manager-editable. `A` = semantically affected; `U` = unaffected. A bundled item is `A` if any included behavior must change. Broad recorded lineage alone does not make a true effect. The content is preserved at the immutable version links above. This map was written before looking at the post-change impact panel.

| Item | Pre-change content / source links | Key | Reason |
|---|---|---|---|
| R-01 | Catalog, receipt, sale, on-hand, negative stock | U | Quantity arithmetic and catalog unchanged. |
| R-02 | Count correction and movement audit | U | Corrections/audit unchanged. |
| R-03 | Per-title threshold and low-stock list | A | Direct rule change. |
| R-04 | Draft proposed PO from reorder list, review, mark sent | A | Bundles draft candidate selection from the list, which changes under a shop-wide threshold, with unchanged review/send. |
| R-05 | One shop/currency, no integrations | U | Operating scope unchanged. |
| ADR-01 | Single web application; refs R-01/R-03/R-04/R-05 | U | Stack/monolith choice remains valid despite broad lineage. |
| ADR-02 | Transactional inventory storage; refs R-01/R-02 | U | Stock movement transactions unchanged. |
| ADR-03 | Persisted reorder thresholds and PO drafts; refs R-03/R-04/R-05 | A | Per-title persisted threshold design and draft selection need a shop-wide setting/query. |
| ADR-04 | Single-currency shop configuration; ref R-05 | U | Configuration scope unchanged. |
| UI-01 | Inventory overview; ref R-01 | U | On-hand browsing unchanged. |
| UI-02 | Add title by ISBN; ref R-01 | U | Catalog entry unchanged. |
| UI-03 | Record receipt/sale/correction; refs ADR-02/R-01/R-02 | U | Stock changes unchanged. |
| UI-04 | Reorder list, per-title threshold setting and draft start; refs ADR-03/R-03/R-04 | A | Must show/edit one shop-wide threshold and recalculate list. |
| UI-05 | Review and mark an already-created PO sent; refs ADR-03/ADR-04/R-04/R-05 | U | Review/send action independent of candidate selection; source link may produce a conservative warning. |
| S-01 | Add title; refs ADR-01/R-01/UI-02 | U | Catalog unchanged. |
| S-02 | Inventory overview; refs ADR-01/R-01/UI-01 | U | On-hand view unchanged. |
| S-03 | One-shop/currency/no integration; refs ADR-04/R-05 | U | Scope unchanged. |
| S-04 | Receipt/sale/audit; refs ADR-01/ADR-02/R-01/R-02/UI-03 | U | Stock changes unchanged. |
| S-05 | Count correction; refs ADR-01/ADR-02/R-02/UI-03 | U | Corrections unchanged. |
| S-06 | Set per-title threshold; refs ADR-03/R-03/UI-04 | A | Replace per-title setting with manager-editable shop value. |
| S-07 | Low-stock list and start draft; refs ADR-03/R-03/R-04/UI-04 | A | Use shop-wide 5 in list query and draft candidate selection. |
| S-08 | Draft/review PO from reorder list; refs ADR-03/R-04/UI-04/UI-05 | A | Bundles changed draft selection with unchanged review. |
| S-09 | Mark reviewed draft sent; refs ADR-03/ADR-04/R-04/R-05/UI-05 | U | Sending a reviewed draft is unchanged. |

No answer-key concept is absent. The proxy condition's distinct item IDs will be evaluated against the same semantic change after the hosted mapping is frozen.
