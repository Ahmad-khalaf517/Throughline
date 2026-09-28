# Case C: AI-assisted structured-template proxy

**Author:** Codex evaluation agent (GPT-6 family; exact variant not exposed), also the evaluator/preregistration author. It had read the brief, checklist and change answer key before authoring. **Prompt:** Case C brief and fixed template in `three-brief-evaluation.md`; no Throughline output used. **Human edits:** none after the first output. **Authoring:** 2026-09-28 11:49:03–11:49:38 UTC (35 seconds; no interruption logged). This is an AI-assisted proxy, not human manual work, and first-exposure time is unavailable.

## Requirements

| ID | Actor, behavior, priority | Acceptance criteria |
|---|---|---|
| R-01 | Organizer creates a one-day event with public description. Must. | Given organizer access, when an event date/description is saved, then a public event page shows that date/description; an end date beyond that day is rejected. |
| R-02 | Organizer defines shifts with start/end and capacity. Must. | Given an event day, when a shift with start before end and capacity >0 is saved, then its time/capacity appear; invalid time/capacity is rejected. |
| R-03 | Volunteer views open shifts. Must. | Given an event, when volunteer opens it, then shifts with unfilled capacity are shown with times/remaining places; full shifts are marked full or waitlist. |
| R-04 | Volunteer signs up and withdraws. Must. | Given an open shift, when volunteer signs up, then roster contains them; when they withdraw, roster no longer contains them and capacity becomes available. |
| R-05 | System enforces capacity under concurrent signups. Must. | Given one remaining place and two simultaneous signup requests, when both commit, then exactly one receives a place and roster size never exceeds capacity. |
| R-06 | Organizer sees roster. Must. | Given a shift, when organizer opens roster, then active confirmed volunteers appear with their signup status and current count. |
| R-07 | System maintains FIFO waitlist with 24-hour offer acceptance. Must. | Given a full shift, when volunteers join waitlist, then order follows signup time; when a place opens, first waitlisted receives an offer, and if unaccepted after 24 hours it expires before the next person is offered; accepting in time assigns no more than capacity. |
| R-08 | System emails confirmations and audits signup/offer changes. Must. | Given confirmed signup or offer, when state commits, then an email records shift/time/status and an immutable audit entry records actor, transition and timestamp; delivery failure is visible to organizer. |

Assumptions: one-day events, organizer and volunteer accounts, email only. Exclusions: payment and background checks.

## Architecture

| ID | Concern | Decision/tradeoff | Source |
|---|---|---|---|
| AD-01 | Event model and permissions | Relational events, shifts, volunteer registrations and role-based access. Organizer edits events/shifts; volunteer manages own signup. Simple query model requires a database service. | R-01, R-02, R-03, R-04, R-06 |
| AD-02 | Concurrency | Serialize signup/acceptance per shift in a transaction, lock shift count, reject over-capacity and deduplicate volunteer registration. Contention is acceptable for small events. | R-04, R-05, R-07 |
| AD-03 | Waitlist offers | Store ordered waitlist position, offer created/expires timestamp at +24h and status; a scheduled worker expires offers and offers the next person. The worker introduces eventual delay, so acceptance checks expiry transactionally. | R-07 |
| AD-04 | Email/audit | Transactional outbox for signup/offer email and append-only state-transition audit. Email delivery is asynchronous, with failures visible to organizers. | R-08 |

## Backlog

| ID | Story, priority | Acceptance criteria | Source |
|---|---|---|---|
| S-01 | Organizer creates a one-day event and description. Must. | Given date/description, when saved, then public page shows both; multi-day input is rejected. | R-01 |
| S-02 | Organizer defines timed shifts/capacity. Must. | Given valid start/end/capacity, when saved, then shift is listed; invalid values are rejected. | R-02 |
| S-03 | Volunteer browses open shifts. Must. | Given an event, when opened, then each shift shows time/remaining capacity and full shifts show waitlist status. | R-03 |
| S-04 | Volunteer signs up or withdraws. Must. | Given an open shift, when signing up, then roster gains volunteer; on withdrawal, roster loses them and a place opens. | R-04 |
| S-05 | System guards concurrent capacity. Must. | Given one place and two concurrent requests, when processed, then exactly one confirms and roster never exceeds capacity. | R-05 |
| S-06 | Organizer views a shift roster. Must. | Given shift, when roster opens, then active confirmed volunteers and count appear. | R-06 |
| S-07 | Volunteer uses FIFO waitlist and accepts time-limited offer. Must. | Given full shift, when multiple join, then first gets next vacancy; if unaccepted at 24h, offer expires and next is offered; an in-time acceptance assigns no more than capacity. | R-07 |
| S-08 | System emails and audits signup/offer transitions. Must. | Given a committed signup/offer/withdrawal, when outbox processes, then email contains shift/status and audit shows actor/time/transition; delivery failure appears to organizer. | R-08 |

## Coverage and impact worksheet before change

| Must concept | Story |
|---|---|
| Event creation | S-01 |
| Timed shift/capacity | S-02 |
| Open-shift view | S-03 |
| Signup/withdrawal | S-04 |
| Concurrent capacity | S-05 |
| Organizer roster | S-06 |
| FIFO waitlist/24-hour offer | S-07 |
| Email confirmation/audit | S-08 |

Architecture references appear in the Architecture table. The controlled-change worksheet is appended after the stimulus is applied to this condition.
