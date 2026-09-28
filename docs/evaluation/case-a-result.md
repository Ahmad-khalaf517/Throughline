# Case A result: cancellation window

The preregistered brief, rubric, and answer key are in [`three-brief-evaluation.md`](three-brief-evaluation.md). The [AI-assisted proxy first output](case-a-proxy.md) and [hosted pre-change scoring and frozen item mapping](case-a-hosted-prechange.md) were saved in commit `5775dc5` before any change to the hosted project. The proxy author and evaluator was the same Codex agent and had already read the answer key. The hosted project was [E6-S5 A](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d).

## Timings and outputs

| Condition | Planning outputs | Completion interval | Change review interval | Timing limit |
|---|---|---|---|---|
| AI-assisted template proxy | [First Requirements, Architecture, Backlog](case-a-proxy.md) | 2026-09-28 10:20:41–10:21:52 UTC; 1m 11s | 10:32:34–10:32:58 UTC; 24s | Author had seen brief and answer key before timing; this is a lower-bound authoring interval, not human manual time. |
| Hosted Throughline | [Requirements v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/5a0ecd47-f936-4548-880b-c62e7ec3d8b4), [Architecture v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/0a90902f-fa22-408e-8ae8-3f6cacc59974), [UI Requirements v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/3f50c830-ae8d-4053-954c-27d46d0dff5d), [Backlog v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/f846c4b7-2584-4bb9-8a84-5262630d00b7) | 10:22:25–10:30:20 UTC; 7m 55s | [Impact view](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/warnings) opened 11:33:40 UTC; affected set and paths understood by 11:34:13 UTC; 33s | Same reviewer authored brief/key. Hosted timer includes enforced UI Requirements gate and browser/generation waits. Change mutation crossed an agent usage interruption, so active mutation time is unavailable. |

No prompt repair, regeneration, warning acknowledgement, external write, or direct database mutation was used for this case. The proxy condition has no automatic warnings; its change worksheet is a human-readable response produced by the same AI-assisted author.

## Change action

Using the hosted UI, I created a manual Requirements draft from approved v1, edited only bundled R-01's `behavior`, previewed the change (the UI said no upstream references needed rebinding), saved it, and approved [Requirements v2](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/cd0d4117-734f-4b11-9270-6059f3e05165). The new behavior states that patients may cancel/reschedule only until 24 hours before start, while reception staff may do either at any time. The original acceptance criteria remain unchanged; they do not test the new cutoff. Approval was visible in the UI. This is one upstream item edit, not an AI revision.

## Impact accuracy against the frozen mapping

The product reported **seven distinct downstream item warnings** from R-01: six direct and one transitive. The fixed semantic answer key expects UI-02 and S-03 to need review; both were surfaced. It expects the remaining five surfaced items to remain semantically valid. The changed root R-01 itself is not a downstream warning and is excluded from the affected-item denominator.

| Condition | True affected downstream found | Affected downstream missed | Unaffected downstream flagged | Warning coverage / explainability |
|---|---:|---:|---:|---|
| AI-assisted template proxy | 2/2 (AD-03, S-03) | 0 | 0 | Manually listed `R-03 → AD-03` and `R-03 → S-03`; no automatic warning mechanism or graph. Its authored items differ from hosted items, so these counts should not be pooled. |
| Hosted Throughline | 2/2 (UI-02, S-03) | 0 | 5 (S-02, UI-01, S-01, ADR-01, S-08) | 7/7 warning paths inspectable in the [warning panel](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/warnings). Six direct paths `R-01 → item`; S-08 is transitive `R-01 → ADR-01 → S-08`. |

The five false positives follow recorded dependencies on bundled R-01 or ADR-01. For example, S-02 is about initial booking, which the cancellation-window rule does not change. ADR-01's modular application choice remains valid; S-08 inherits that broad dependency. No architecture decision encoding modification eligibility existed in the hosted v1, so that expected concept was recorded as **not instantiated** before the change and was not scored as a miss. The panel uses conservative “potentially affected; review recommended” wording, so a false positive here means an unnecessary review under the predefined semantic answer key, not a false claim of definite breakage.

## Fixed-checklist planning scores

The item-level scoring and reasons were frozen in [the pre-change evidence](case-a-hosted-prechange.md). Summary: requirements completeness **8/8** in both conditions; functional requirement acceptance criteria **8/8 proxy vs 1/4 hosted**; story acceptance criteria **8/8 proxy vs 7/8 hosted**; valid story-to-Requirement traceability **8/8 proxy vs 7/8 hosted** (the hosted quality gate surfaced S-08's missing Requirement); architecture-to-Requirement links **4/4** in both; must-concept backlog coverage **8/8** in both. The proxy scores are influenced by the evaluator's prior knowledge of the rubric and should not be treated as a fair independent baseline.

**Case conclusion:** The hosted run completed its three named planning outputs and the required UI prerequisite. It surfaced both true affected downstream items and five conservative but semantically unnecessary review warnings. The case exposes a real tradeoff between complete dependency-path visibility and noise from bundled Requirements/broad lineage; no direction of overall product superiority is inferred from this one case.
