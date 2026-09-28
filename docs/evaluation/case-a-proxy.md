# Case A: AI-assisted structured-template proxy

**Author:** Codex evaluation agent (GPT-6 family; exact model variant not exposed to this agent). Same agent wrote the preregistration and will review both conditions; it had already seen the answer key and the brief before timing began. **Prompt:** case A brief and the fixed structured template in `three-brief-evaluation.md`, with no Throughline output. **Human edits:** none after this saved first output. **Authoring:** 2026-09-28 10:20:41–10:21:52 UTC (1 minute 11 seconds elapsed; no interruptions logged). This is an AI-assisted proxy, not a human manual baseline. Because the author knew the brief and key beforehand, this authoring time is a lower-bound preparation interval, not a comparable first-exposure time.

## Requirements

| ID | Title / actor / behavior | Rule and priority | Acceptance criteria |
|---|---|---|---|
| R-01 | Patient views open slots by clinician and date. | Must. Exclude blocked and booked slots. | Given a date and clinician, when a patient opens availability, then only that clinician's unblocked, unbooked future slots for that date appear. |
| R-02 | Patient requests a slot. | Must. A request produces one confirmed appointment or a conflict. | Given an open slot, when a patient submits a request with contact email, then one appointment is confirmed and shown; given the slot was taken meanwhile, then a conflict is shown and no second appointment is created. |
| R-03 | Patient cancels or reschedules an appointment. | Must. Reschedule releases the old slot only if the new one is secured. | Given a patient's confirmed appointment, when they cancel, then it is removed from active schedule; when they choose another open slot, then the new slot is booked and the old one released atomically, or the original booking stays if the new slot is unavailable. |
| R-04 | Reception staff publishes clinician availability and blocks times. | Must. Blocked slots cannot be newly booked. | Given staff access, when availability is added or a time blocked, then patient slot search reflects the change; attempting to book a blocked time fails. |
| R-05 | System prevents double booking. | Must. At most one confirmed appointment per clinician/start-time slot even for simultaneous requests. | Given two concurrent requests for one slot, when both submit, then exactly one confirms and the other receives a conflict. |
| R-06 | System sends an email confirmation. | Must. Email only; failed delivery is visible to staff. | Given a confirmed booking, when confirmation is queued, then email includes clinician, date, time and appointment reference; if delivery fails, staff sees a failed state. |
| R-07 | Reception staff sees the day's schedule. | Must. Staff can filter by clinician. | Given staff access and a date, when schedule is opened, then all active bookings for that date and selected clinician appear in chronological order. |
| R-08 | System records booking changes. | Must. Record actor, action, old/new time and timestamp. | Given create, cancel or reschedule, when the action succeeds, then an immutable audit entry identifies the actor and before/after booking details. |

Assumptions: one clinic, three clinicians, authenticated staff, patient access through an appointment reference and verified email. Exclusions: emergencies, advice, symptom triage and clinical records.

## Architecture

| ID | Concern | Decision and reason/tradeoff | Sources |
|---|---|---|---|
| AD-01 | Scheduling data | Store clinicians, availability windows, blocks, slots and appointments in a relational database. Query open slots from availability minus blocks/confirmed appointments. Clear consistency at the cost of maintaining slot state. | R-01, R-02, R-04, R-07 |
| AD-02 | Concurrent writes | Book and reschedule in database transactions; enforce a unique constraint on active appointment slot. Return conflict on constraint failure. This centralizes the invariant at the cost of serial contention on popular slots. | R-02, R-03, R-05 |
| AD-03 | Identity and access | Staff use role-based accounts. Patients present a time-limited signed appointment link sent to verified email; the link permits only that booking's change actions. No medical information is stored. | R-03, R-04, R-07 |
| AD-04 | Email and audit | Commit booking plus append-only audit record, then enqueue confirmation email through an outbox worker; show failed delivery to staff. This avoids an email failure rolling back a valid booking but makes delivery asynchronous. | R-06, R-08 |

## Backlog

| ID | Story / priority | Acceptance criteria | Sources |
|---|---|---|---|
| S-01 | As a patient, browse clinician/date openings. Must. | Given a clinician/date, when opened, then only future open slots appear; blocked or booked slots do not. | R-01, R-04 |
| S-02 | As a patient, request a slot. Must. | Given an open slot and email, when requested, then a confirmed reference appears; if already taken, a conflict appears and no booking is added. | R-02, R-05 |
| S-03 | As a patient, cancel or reschedule. Must. | Given a valid appointment link, when canceling, then booking becomes inactive; when rescheduling to an available slot, then old/new slot states change atomically; otherwise original booking remains. | R-03 |
| S-04 | As reception staff, publish and block clinician time. Must. | Given staff login, when availability/block is saved, then open-slot search updates; a blocked slot cannot be newly booked. | R-04 |
| S-05 | As the system, prevent concurrent booking conflicts. Must. | Given two simultaneous requests for the same slot, when processed, then one succeeds and one receives a conflict; no duplicate active appointments exist. | R-05 |
| S-06 | As a patient, receive booking email. Must. | Given confirmed booking, when email worker runs, then message contains clinician/time/reference; on failure, delivery state is visible to staff. | R-06 |
| S-07 | As reception staff, view the day's schedule. Must. | Given a date/clinician filter, when opened, then active appointments appear in time order and other clinicians are excluded. | R-07 |
| S-08 | As reception staff, inspect booking history. Must. | Given a booking, when history is opened, then create/cancel/reschedule entries show actor, timestamp and previous/new time; entries cannot be edited. | R-08 |

## Coverage and impact worksheet before change

| Must requirement | Implementing stories |
|---|---|
| R-01 | S-01 |
| R-02 | S-02 |
| R-03 | S-03 |
| R-04 | S-01, S-04 |
| R-05 | S-02, S-05 |
| R-06 | S-06 |
| R-07 | S-07 |
| R-08 | S-08 |

Architecture references are in the architecture table. The change-impact worksheet will be completed only after the preregistered change is supplied to this condition, with time recorded separately.
