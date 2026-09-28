# Case B result: shop-wide reorder threshold

The three briefs, rubric, and answer keys were fixed in [`three-brief-evaluation.md`](three-brief-evaluation.md). The [AI-assisted proxy first output](case-b-proxy.md) and [hosted pre-change scores/item mapping](case-b-hosted-prechange.md) were frozen in commit `f5b3445` before the hosted mutation. The same Codex agent authored the proxy, preregistration, and scores; it knew the answer key before both conditions. This is not a human manual baseline.

## Timings and output links

| Condition | Planning outputs | Planning interval | Change interpretation |
|---|---|---|---|
| AI-assisted template proxy | [First Requirements, Architecture, Backlog](case-b-proxy.md) | 2026-09-28 11:35:57–11:36:47 UTC, 50s | Worksheet 11:45:01–11:45:33 UTC, 32s. Prior exposure to brief/key biases both intervals. |
| Hosted Throughline | [Requirements v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/eae269e3-a382-4500-8cf2-2d936d44cf34), [Architecture v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/a8a69535-3eef-464a-8ba7-18f1635c3c63), [UI Requirements v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/da4f1ac1-c8ea-4b59-84bb-7d6599fa2b02), [Backlog v1](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/c544a1b6-a3ef-402e-9e36-fe65210b2bcc) | 11:37:19–11:42:59 UTC, 5m 40s including generation waits and required UI approval | [Impact view](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/warnings) opened 11:46:54 UTC; set/paths understood by 11:47:34 UTC, 40s. Mutation itself took 11:45:49–11:46:54 UTC, 65s. |

## Controlled change and observed impact

Through the hosted UI, I created a manual Requirements revision, edited only R-03 `behavior`, previewed it (no upstream rebinding needed), saved, and approved [Requirements v2](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/versions/75122688-d3d5-4d98-9c93-430937a13fb3). The new behavior specifies one manager-editable shop-wide threshold initially set to 5 units, applied to all titles. R-03's old per-title acceptance criteria were not updated by the behavior-only edit, leaving an internal inconsistency in the revised Requirement. No AI regeneration, warning acknowledgement, external write, or direct database mutation occurred.

The [warning panel](https://throughline-mauve-three.vercel.app/projects/b4b0e638-fab6-47d9-bf95-869b889f06a9/warnings) showed **12 distinct downstream item warnings** from R-03: 5 direct and 7 transitive, all with a visible source-to-subject path. The frozen semantic key expects five of those warned items to change: ADR-03, UI-04, S-06, S-07, S-08. It also expects R-04, a same-artifact Requirement about drafting from the reorder list, to need review because its candidate set changes; the impact traversal did not surface this sibling Requirement. Root R-03 itself is excluded from the affected-item denominator.

| Condition | True affected non-root found | Affected missed | Unaffected flagged | Explainability |
|---|---:|---:|---:|---|
| AI-assisted template proxy | 5/5 (R-07, AD-01, AD-03, S-06, S-07) | 0 | 0 | Authored paths in worksheet; no automatic warnings or graph. Different generated items mean its counts cannot be pooled with hosted counts. |
| Hosted Throughline | 5/6 (ADR-03, UI-04, S-06, S-07, S-08) | 1 (R-04) | 7 (ADR-01, S-05, S-09, S-01, S-04, UI-05, S-02) | 12/12 warning paths inspectable. Examples: direct `R-03 → UI-04`; transitive `R-03 → UI-04 → S-08`; broad false-positive path `R-03 → ADR-01 → S-05`. |

R-04's miss is a semantic gap for this preregistered answer key: the PO draft source list changes, but the product's dependency graph does not encode an edge between sibling Requirements. The seven false positives are review prompts caused by broad recorded links to the monolith decision ADR-01 or the combined reorder/PO decision ADR-03, even though the catalog, stock corrections, and review/send action remain valid. The panel correctly uses “potentially affected; review recommended,” so these are unnecessary reviews under this key, not incorrect assertions of definite breakage.

## Fixed-checklist planning scores

The [pre-change scoring sheet](case-b-hosted-prechange.md) records reasons per item. Both conditions cover all **8/8** required concepts and all **8/8** concepts have a story. Functional Requirement AC completeness is **8/8 proxy vs 2/4 hosted**; Story AC completeness is **8/8 proxy vs 5/9 hosted**. Story-to-Requirement links are **8/8 proxy vs 9/9 hosted**, with zero missing-link warning in either. ADR-to-Requirement links are **4/4** in each. The proxy scores reflect an answer-key-exposed AI author and do not establish superiority over the hosted workflow.

**Case conclusion:** The bookstore workflow completed all named outputs plus its required UI step. It surfaced five of six semantically affected non-root items, missed the sibling PO Requirement, and asked for seven additional reviews. The result is a case-specific measurement, not an extrapolated success rate.
