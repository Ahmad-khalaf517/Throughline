# Case C result: waitlist offer expiry

The fixed brief, checklist and answer key are in [`three-brief-evaluation.md`](three-brief-evaluation.md). The [AI-assisted template proxy first output](case-c-proxy.md) and [hosted pre-change scores/item mapping](case-c-hosted-prechange.md) were frozen in commit `c301fc6` before the hosted mutation. The proxy author and evaluator were the same Codex agent, already exposed to the answer key. The proxy is not a human manual baseline.

## Timings and output links

| Condition | Planning outputs | Planning interval | Change interpretation |
|---|---|---|---|
| AI-assisted template proxy | [First Requirements, Architecture, Backlog](case-c-proxy.md) | 2026-09-28 11:49:03–11:49:38 UTC, 35s | Worksheet 12:01:48–12:02:04 UTC, 16s. Prior brief/key exposure biases both intervals. |
| Hosted Throughline | [Requirements v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/fb466658-ca64-4c2e-9d9e-0e1a4f84c0c7), [Architecture v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/d6342f93-8133-45c5-a279-b3698892e88c), [UI Requirements v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/ec18d6fb-eabf-4042-82de-ed4b7aff9078), [Backlog v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/2059cfa8-b58a-4933-b31a-79d3c98707d7) | 11:50:26–11:59:51 UTC, 9m 25s including generation waits, browser-control timeouts, and required UI approval | [Impact view](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/warnings) opened 12:03:43 UTC; set/paths understood by 12:03:58 UTC, 15s. Mutation took 12:02:18–12:03:43 UTC, 1m 25s. |

## Controlled change and impact

In the hosted UI, I created a manual Requirements revision from approved v1, edited only R-03 `behavior`, previewed it (no upstream rebinding needed), saved it, and approved [Requirements v2](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/1781ace3-0c3a-47a5-ba12-de4c27c2f429). The behavior now requires acceptance within 12 hours before offering the place to the next waitlisted volunteer, while keeping waitlist order and other signup rules. The original 24-hour acceptance criterion remained unchanged, so v2 has an internal conflict that would require a later criteria edit. This behavior-only revision was used to keep the upstream mutation to one item. No AI regeneration, warning acknowledgement, external write, or direct database mutation occurred.

The hosted [warning panel](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/warnings) showed **four distinct direct warnings**, zero transitive: ADR-02, UI-03, S-04 and S-05. All four are semantically affected under the frozen answer key. Each warning exposed `R-03 → item`; all four paths were inspectable. Root R-03 is excluded from downstream counts.

| Condition | True affected non-root found | Affected missed | Unaffected flagged | Explainability |
|---|---:|---:|---:|---|
| AI-assisted template proxy | 2/2 (AD-03, S-07) | 0 | 0 | Authored `R-07 → AD-03 → S-07` / `R-07 → S-07`; no automatic warning mechanism. |
| Hosted Throughline | 4/4 (ADR-02, UI-03, S-04, S-05) | 0 | 0 | 4/4 warning paths visible; no false positive in this case. |

## Fixed-checklist planning scores

The [pre-change sheet](case-c-hosted-prechange.md) explains the item-level decisions. Requirements completeness and must-concept backlog coverage were **8/8 in both conditions**. Functional Requirement AC completeness was **8/8 proxy vs 1/4 hosted**; Story AC completeness **8/8 proxy vs 4/8 hosted**. Valid story-to-Requirement links were **8/8 in both**, with zero missing/invalid link warnings. ADR-to-Requirement links were **4/4 proxy vs 5/5 hosted**. Proxy scores are influenced by prior rubric/key exposure and are not an independent baseline.

**Case conclusion:** The hosted project completed the named outputs plus its enforced UI step. Its impact warnings exactly matched the four downstream items in this case's frozen key, with inspectable paths. The unchanged 24-hour criterion in revised R-03 is a separate observed output inconsistency, and the result does not imply the same accuracy for other changes.
