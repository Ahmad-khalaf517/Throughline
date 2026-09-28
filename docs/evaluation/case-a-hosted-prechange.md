# Case A: hosted Throughline, pre-change snapshot and scoring

**Project:** [E6-S5 A — Neighborhood clinic appointments](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d). **Reviewer:** the same Codex agent that authored the AI-assisted proxy and preregistration; it knew the answer key. **Start:** 2026-09-28 10:22:25 UTC (first project form entry; evaluator had previously authored/read the brief). **Three outputs approved:** 10:30:20 UTC. Elapsed 7 minutes 55 seconds, including browser interaction and generation waits; no interruption subtracted. This is a preparation interval, not a blinded first-exposure time.

Immutable approved versions: [Requirements v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/5a0ecd47-f936-4548-880b-c62e7ec3d8b4) (6 items), [Architecture v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/0a90902f-fa22-408e-8ae8-3f6cacc59974) (selected Option A, relational modular monolith; 4 ADRs), [UI Requirements v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/3f50c830-ae8d-4053-954c-27d46d0dff5d) (5 items), [Backlog v1](https://throughline-mauve-three.vercel.app/projects/c6586fcb-1fcc-490d-b5f3-eb8e85b81f1d/versions/f846c4b7-2584-4bb9-8a84-5262630d00b7) (3 epics, 8 stories). These links are the raw, inspectable output snapshots; the item summaries and scores below were transcribed from the hosted UI before mutation. UI Requirements generation and approval was an enforced prerequisite to Backlog, and is included in the clock even though the BRD names three planning outputs.

## Fixed-checklist scoring before change

| Measure | AI-assisted template proxy | Hosted Throughline | Observed reason |
|---|---:|---:|---|
| Requirements completeness | 8/8 | 8/8 | Hosted R-01 bundles three patient concepts; R-02 bundles staff availability and schedule; R-03 covers concurrency; R-04 bundles email and audit. All eight are present, though some are thin. |
| Requirement AC complete | 8/8 | 1/4 | Hosted functional R-03 gives a condition and observable one-winner/conflict outcome. R-01, R-02, R-04 criteria mostly restate capabilities without a test condition or full result; R-04 audit omits actor/before-after details. Constraints R-05/R-06 are excluded from the functional denominator by the rubric. |
| Story AC complete | 8/8 | 7/8 | Hosted S-03 has cancel/reschedule actions but no expected post-cancellation state or atomic release/retention outcome. Other stories have observable outcomes for their stated work. |
| Valid story source traceability | 8/8 | 7/8 | S-01–S-07 have valid source Requirement links. S-08 cites ADR-01 only, with no source Requirement; the hosted quality gate surfaced `story_no_source_requirement` for S-08 (1 warning). The UI's coarse `8 of 8 Stories have source references` count includes its ADR-only link. |
| Valid architecture-to-requirement links | 4/4 | 4/4 | ADR-01→R-01/R-02, ADR-02→R-03, ADR-03→R-05, ADR-04→R-04/R-06 are resolvable and semantically related, though some relationships are broader than the decision. |
| Backlog must-concept coverage | 8/8 implemented; 0 uncovered | 8/8 implemented; 0 uncovered | See concept mapping below. No explicit uncovered item and no silent must-concept gap. |

The hosted Requirements quality gate also surfaced one unresolved assumption: whether patients authenticate before managing an appointment. It did not block approval. The Architecture option comparison showed no trade-offs supplied for either candidate. The Backlog quality gate did not block S-08 approval. These are observed weaknesses, not corrected during the frozen-output review.

### Requirement concept and backlog mapping

| Fixed A concept | Hosted Requirement | Hosted Story | Proxy Requirement / Story |
|---|---|---|---|
| View slots by clinician/date | R-01 | S-01 | R-01 / S-01 |
| Request a slot | R-01 | S-02 | R-02 / S-02 |
| Cancel/reschedule | R-01 | S-03 | R-03 / S-03 |
| Staff availability/blocking | R-02 | S-04 | R-04 / S-04 |
| Concurrent one-booking invariant | R-03 | S-02 | R-05 / S-05 |
| Email confirmation | R-04 | S-02 | R-06 / S-06 |
| Staff daily schedule | R-02 | S-05 | R-07 / S-07 |
| Booking-change audit | R-04 | S-06 | R-08 / S-08 |

### Hosted item-by-item pre-change impact mapping

**Frozen before changing R-01.** `A` means affected by the preregistered 24-hour patient cancellation/rescheduling window; `U` means unaffected; `N` means the expected concept was not instantiated. A bundled item is `A` if its cancellation/rescheduling behavior changes. Display keys are the hosted UI's item identifiers; the immutable version links above preserve their original contents. This mapping must not be revised after viewing impact output.

| Item | Pre-change content / actual source links | Key | Reason |
|---|---|---|---|
| R-01 | Patient slot browsing, request, cancel/reschedule | A | Bundles the patient modification behavior to be restricted. |
| R-02 | Staff availability, blocks, daily schedule | U | No patient modification rule. |
| R-03 | Exclusive confirmed slot under concurrency | U | Booking uniqueness unchanged. |
| R-04 | Appointment history, staff email, confirmation | U | Audit recording remains; no cancellation-message timing specified. |
| R-05 | Non-emergency/no clinical scope | U | Scope unchanged. |
| R-06 | One clinic/three clinicians/email-only | U | Operating scope unchanged. |
| ADR-01 | Modular application; depends on R-01, R-02 | U | Broad backend split remains valid; no authorization/eligibility rule is encoded. A warning from the broad R-01 dependency would be a semantic false positive. |
| ADR-02 | Exclusive slot booking; depends on R-03 | U | Uniqueness invariant unchanged. |
| ADR-03 | Appointment-only data; depends on R-05 | U | Data exclusion unchanged. |
| ADR-04 | Email notifications; depends on R-04, R-06 | U | No cancellation/rescheduling message timing is specified. |
| UI-01 | Patient slot search/request; refs ADR-02, ADR-04, R-01, R-03, R-04 | U | Does not describe changing an existing appointment. Broad R-01 link alone is insufficient for a true effect. |
| UI-02 | Patient cancellation/rescheduling; refs ADR-02, R-01, R-03, R-04 | A | Must display or enforce time/role eligibility and rejection outcome. |
| UI-03 | Staff availability; refs R-02, R-06 | U | No patient modification. |
| UI-04 | Daily schedule; refs R-02 | U | Schedule view unchanged. |
| UI-05 | Staff appointment history/email; refs ADR-04, R-04 | U | No cancellation timing or patient modification permission described. |
| S-01 | Patient finds slots; refs R-01, UI-01 | U | Search behavior unchanged. |
| S-02 | Patient requests slot/gets confirmation; refs ADR-02, ADR-04, R-01, R-03, UI-01 | U | Initial booking unchanged. |
| S-03 | Patient cancellation/rescheduling; refs ADR-02, R-01, R-03, UI-02 | A | Patient change action must enforce 24-hour cutoff. |
| S-04 | Staff publishes/blocks availability; refs R-02, UI-03 | U | Availability unchanged. |
| S-05 | Staff views daily schedule; refs R-02, UI-04 | U | Schedule view unchanged. |
| S-06 | Staff reviews history/emails patient; refs ADR-04, R-04, UI-05 | U | History and generic contact unaffected. |
| S-07 | Clinic operating/clinical scope; refs ADR-03, ADR-04, R-05, R-06 | U | Scope unchanged. |
| S-08 | Django modular backend; ref ADR-01 only | U | Architecture shape unchanged. |
| Concept absent | A specific modification-authorization / 24-hour eligibility ADR | N | Architecture chose no decision that encodes patient modification timing or actor-role eligibility. Do not count an absent item as a miss or true negative. |

## Controlled change

Not applied at this snapshot. The proxy change worksheet and hosted impact findings will be appended in separate case-A result evidence after the controlled change. The A/U mapping above was saved first.
