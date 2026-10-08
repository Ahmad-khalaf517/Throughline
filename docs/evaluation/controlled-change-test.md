# E6-S4 controlled change test — sofa-cover product details

**Run:** 2026-09-28 UTC, hosted [Project E6 Demo — Sofa Covers](https://throughline-mauve-three.vercel.app/projects/bf9a4bcb-88d1-43ce-b95b-6df296c85816). **Story:** SCRUM-70 / E6-S4. This is the single controlled-change test specified by [BRD §10.3](../Throughline_BRD.md#103-controlled-change-test) using the manual revision path in [FR-081](../Throughline_Technical_Requirements_Lineage_Invariants.md#fr-081---revision-paths).

## Answer key and procedure

The content-based answer key was registered **before mutation** in [SCRUM-70 comment 11171](https://ahmadyaserkhalaf.atlassian.net/browse/SCRUM-70?focusedCommentId=11171): adding care instructions for sofa-cover material to R-02 should affect **UI-02** and **S-02**. ADR-01 has a declared dependency on R-02, but its Django monolith choice and rationale should remain semantically valid; flagging it counts as a false positive. Other ADR, UI, and Story items were expected to remain unaffected. Existing R-04 warnings from E6-S1 are outside this answer key.

I used the authenticated hosted UI to create a manual Requirements revision from approved v2, edit only R-02, preview the edit (the UI reported no upstream references to rebind), and approve v3. Read-only production SQL checked version membership, `impact(project)`, generation context, AI run logs, and external write records. No direct database mutation was used.

R-02 behavior changed from “The customer can view product details for a sofa cover.” to “The customer can view product details for a sofa cover, including its sofa size, fabric, color, fit, and care instructions for the cover material.” The existing acceptance criteria about size, fabric, color, fit, and opening the detail view were left unchanged. The UI editor exposed the behavior field for this manual item edit.

## Revision isolation

Requirements [v2](https://throughline-mauve-three.vercel.app/projects/bf9a4bcb-88d1-43ce-b95b-6df296c85816/versions/2ea896cc-7def-4aac-8f05-1c03d72f895c) was approved at the start and is now superseded. [v3](https://throughline-mauve-three.vercel.app/projects/bf9a4bcb-88d1-43ce-b95b-6df296c85816/versions/2d3dde3d-544d-4a42-98c4-e71005ff933c) was created at 09:55:46 UTC from v2 and approved at 09:57:26 UTC. A read-only check of the draft before editing showed **all six ItemVersion IDs reused** from v2. The approved membership diff is:

| Item | v2 ItemVersion | v3 ItemVersion | Result |
| --- | --- | --- | --- |
| R-01 | `ee27ae89-a01c-46fe-8047-1ed1e8ab3aee` | same | Reused |
| R-02 | `f4174af2-40e1-44f1-93fa-a06017197afb` (revision 1) | `2c5c2e44-2e3d-49fc-9aa0-63bfd6f790ea` (revision 2) | Only changed item |
| R-03 | `eef233ca-2efe-401f-81ab-75b015636c6b` | same | Reused |
| R-04 | `57dcfdad-0988-4b81-b18c-28657e0ac97d` | same | Reused |
| R-05 | `10fd72aa-f195-42a8-b41a-e335ae1bd45e` | same | Reused |
| R-06 | `b74453e2-3ef4-41e9-bae1-6f5dbae88694` | same | Reused |

The v2/v3 R-02 JSON payload differs only in `behavior`; the other payload fields are byte-for-byte equal as JSON values. R-02 revision 2 was the only project `item_version` created after the v3 draft. The v3 `generation_context_ref` count is zero, and no `ai_generation_run` was recorded for this project after draft creation. This supports the observed manual, one-item change without model output mixed into the revision.

## Impact result against the registered key

The [warnings view](https://throughline-mauve-three.vercel.app/projects/bf9a4bcb-88d1-43ce-b95b-6df296c85816/warnings) and read-only `impact(project)` query identify the obsolete R-02 ItemVersion as the new root. Its **three unique item subjects** are all direct; one additional row is a Jira external reference downstream of S-02.

| R-02-root subject | Stored dependency path | Classification against answer key |
| --- | --- | --- |
| UI-02 | R-02 → UI-02 | True positive: product-details interaction still lists size, fabric, color, and fit but lacks material care instructions. |
| S-02 | R-02 → S-02 | True positive: product-details story and acceptance criteria still omit material care instructions. |
| ADR-01 | R-02 → ADR-01 | False positive by content: the integrated Django application and its server-rendered product-details approach remain valid. The warning is explainable by the declared edge. |
| Jira `TAE-12` external reference | R-02 → S-02 → `TAE-12` | Downstream provenance warning for the same S-02, **not** a fourth unique item and not separately scored as an item false positive. |

**Score on unique ADR/UI/Story items:** 2 true positives, **0 missed affected items**, 1 false positive; recall 2/2, precision 2/3. No other R-02-root item was flagged. The R-02 root has 4 rows total: 3 direct item rows and 1 transitive external-reference row. The warning panel displays the external row as a second “S-02” entry at Tier 2 with path R-02 → S-02; the read-only provenance lookup was needed to identify the Jira endpoint `TAE-12`. This limits explainability in the UI even though the stored path is traceable.

Before this run, R-04 already produced 8 unique item warnings and 3 Jira external-reference rows (11 rows). After this run those R-04-root results persisted; they were excluded from the R-02 score. The panel's overall 15 warnings are 11 baseline R-04 rows plus 4 new R-02 rows, rather than 15 distinct affected items. No warnings were acknowledged: the project has zero `impact_acknowledgement` rows.

**Time to understand the paths:** warning view opened at approximately 09:59:10 UTC; the R-02 item paths were visible by 09:59:22 UTC, about 12 seconds later. Full interpretation of the duplicate S-02/Tier-2 row as the Jira `TAE-12` external reference, using a read-only lineage query, was completed at 10:01:50 UTC, about **2 minutes 40 seconds** after opening. This includes query and investigation time, so it is a conservative reviewer-time measure.

The test made no Jira or GitHub write. Read-only records showed 10 project external refs, with the latest created at 09:05:54 UTC, and 12 external operations, with the latest update at 09:10:15 UTC—both before this controlled change. The test did not independently audit remote Jira issue content.

## Limits and scope

This is one exploratory hosted-project change reviewed by the implementer, not a statistical accuracy estimate. It does not run BRD §10.1–10.2's three-brief comparison or the E6-S6 evaluation write-up. The unchanged R-02 acceptance criteria do not yet explicitly test care instructions; this test measures impact detection from the one behavior edit, not downstream repair. No item repair, warning acknowledgement, regeneration, new Jira issue, or GitHub action was performed.
