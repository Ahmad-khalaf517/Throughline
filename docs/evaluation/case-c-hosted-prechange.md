# Case C: hosted Throughline, pre-change snapshot and scoring

**Project:** [E6-S5 C — Volunteer event signup](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6). **Reviewer:** the same Codex agent that wrote the preregistration and AI-assisted proxy; it knew the answer key. **Planning timer:** 2026-09-28 11:50:26–11:59:51 UTC, 9m 25s elapsed. This includes generation waits, browser-control timeouts, and the required UI Requirements approval; no interruption was subtracted.

Raw approved output snapshots: [Requirements v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/fb466658-ca64-4c2e-9d9e-0e1a4f84c0c7) (5 items), [Architecture v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/d6342f93-8133-45c5-a279-b3698892e88c) (Option A transactional monolith, 5 ADRs), [UI Requirements v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/ec18d6fb-eabf-4042-82de-ed4b7aff9078) (4 UI items), [Backlog v1](https://throughline-mauve-three.vercel.app/projects/f6452941-f064-4ae7-8719-66305a0d68f6/versions/2059cfa8-b58a-4933-b31a-79d3c98707d7) (3 epics, 8 stories). The linked versions preserve first output for inspection. Quality gates showed no deterministic finding. Architecture candidates supplied no trade-offs.

## Fixed-checklist scores before change

| Measure | AI-assisted template proxy | Hosted Throughline | Item-level reason |
|---|---:|---:|---|
| Requirements completeness | 8/8 | 8/8 | Hosted R-01 bundles event and shift creation, R-02 bundles open shifts/signup/withdrawal/concurrent capacity/email, R-03 covers FIFO 24-hour offers, R-04 covers roster and change records. |
| Functional Requirement AC complete | 8/8 | 1/4 | R-03 gives vacancy, first-offer, 24-hour expiry and next-offer outcomes. R-01 mainly restates creation capability without valid-time/capacity outcomes; R-02 omits successful signup/withdrawal state; R-04 records changes without actor/timestamp criteria. R-05 is a constraint, excluded. |
| Story AC complete | 8/8 | 4/8 | S-02, S-04, S-06, S-08 give observable outcomes for their work. S-01 lacks validation outcomes for event/shift creation; S-03 omits confirmed/withdrawn roster state; S-05 omits acceptance result and full/expired rejection; S-07 omits actor/timestamp detail for the audit record. |
| Valid story-to-Requirement links | 8/8 | 8/8 | Every hosted Story has a resolvable and semantically related R reference; quality gate surfaced 0 missing/invalid link warnings. |
| Valid ADR-to-Requirement links | 4/4 | 5/5 | ADR-01→R-02, ADR-02→R-03, ADR-03→R-04, ADR-04→R-02, ADR-05→R-05. |
| Must-concept backlog coverage | 8/8 implemented | 8/8 implemented | Mapping below; no must concept explicitly or silently uncovered. |

### Concept and Story mapping

| Fixed C concept | Hosted R | Hosted S | Proxy R/S |
|---|---|---|---|
| Create event | R-01 | S-01 | R-01/S-01 |
| Timed shift/capacity | R-01 | S-01 | R-02/S-02 |
| View open shifts | R-02 | S-02 | R-03/S-03 |
| Signup/withdrawal | R-02 | S-03 | R-04/S-04 |
| Concurrent capacity | R-02 | S-03 | R-05/S-05 |
| Organizer roster | R-04 | S-06 | R-06/S-06 |
| FIFO waitlist/24-hour offer | R-03 | S-04, S-05 | R-07/S-07 |
| Email/audit | R-02, R-04 | S-03, S-07 | R-08/S-08 |

### Frozen item mapping for 12-hour offer expiry

`A` = a change needed under the preregistered 12-hour acceptance window; `U` = semantically unaffected. The altered root R-03 is included in the mapping but excluded from downstream impact counts. The first-output contents are at the immutable version links above. This classification was saved before seeing the post-change impact panel.

| Item | Pre-change content / source references | Key | Reason |
|---|---|---|---|
| R-01 | Event/shift setup | U | Event and shift definitions unchanged. |
| R-02 | Open shifts, signup/withdrawal, capacity, email confirmation | U | Initial signup and withdrawal unchanged; no waitlist offer email timing. |
| R-03 | Waitlist first offer, acceptance within 24h, expiry and next | A | Direct window change. |
| R-04 | Organizer roster/waitlist order/change history | U | Ordering and audit recording unchanged. |
| R-05 | No payments/background checks | U | Scope unchanged. |
| ADR-01 | Transactional signup; ref R-02 | U | Capacity transaction unchanged. |
| ADR-02 | Background worker, ordered offers, 24-hour expiry; ref R-03 | A | Worker schedule and expiry check must use 12h. |
| ADR-03 | Append-only change history; ref R-04 | U | Audit recording unchanged. |
| ADR-04 | Signup/withdrawal confirmation email; ref R-02 | U | No offer-window text/timing specified. |
| ADR-05 | Product scope; ref R-05 | U | Exclusions unchanged. |
| UI-01 | Organizer event setup; ref R-01 | U | Setup unchanged. |
| UI-02 | Volunteer open shifts, signup/withdrawal; refs ADR-01/ADR-04/R-01/R-02 | U | Direct signup behavior unchanged. |
| UI-03 | Waitlist offer, expiry displayed, accept/decline; refs ADR-02/R-03 | A | Must show/check 12h deadline. |
| UI-04 | Organizer roster/waitlist order/change history; refs ADR-03/R-04 | U | Same roster/order/history behavior. |
| S-01 | Create event/shifts; refs R-01/UI-01 | U | Setup unchanged. |
| S-02 | View shift availability; refs R-02/UI-02 | U | Browsing unchanged. |
| S-03 | Direct signup/withdrawal and email; refs ADR-01/ADR-04/R-02/UI-02 | U | Direct signup unchanged. |
| S-04 | Issue ordered offer, expire after 24h, advance; refs ADR-02/R-03 | A | Worker expiry timing changes. |
| S-05 | Show expiry and accept/decline before it; refs R-03/UI-03 | A | Deadline display and acceptance guard change. |
| S-06 | Organizer roster/waitlist and history; refs R-04/UI-04 | U | No offer window encoded. |
| S-07 | Append-only signup/withdrawal/offer audit; refs ADR-03/R-04 | U | Same transitions recorded, regardless of window. |
| S-08 | No payments/background checks; refs ADR-05/R-05 | U | Scope unchanged. |

No expected concept is absent. The proxy has different items and will be evaluated separately against the same semantic stimulus.
