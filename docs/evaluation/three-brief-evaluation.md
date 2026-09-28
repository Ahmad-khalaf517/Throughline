# E6-S5: three-brief evaluation preregistration

**Prepared:** 2026-09-28 10:16 UTC, before any E6-S5 sample run or project mutation.  
**Status:** Preregistration for coordinator review. Results have not been collected.  
**Source:** BRD §§10.1–10.3; Jira Plan E6-S5 / SCRUM-71.  
**Evaluation setting:** One developer/evaluator is expected. The user chose an **AI-assisted template proxy** for the manual condition. This is not a human manual baseline. Record the author, model/tool, prompts, and any human edits. Apply the same review checklist to both conditions.

This document fixes the briefs, template, checklist, change stimuli, and answer keys before the hosted runs. Append observations below without altering this section after the first run. If a correction is necessary, date it and retain the original text in the history.

## Briefs supplied verbatim to both conditions

### A. Neighborhood clinic appointments

A small neighborhood clinic needs a web tool for patients and reception staff to request and manage **non-emergency appointments**. Patients can see open appointment slots by clinician and date, request one, cancel or reschedule it, and receive a confirmation. Reception staff can publish clinician availability, block unavailable times, and view the day's schedule. A slot may hold at most one confirmed appointment. The clinic wants an audit trail of booking changes and a way to contact the patient about an appointment. The tool must avoid double booking when two people select the same slot. It must not give medical advice, triage symptoms, or store clinical records. Assume one clinic, three clinicians, and email as the only notification channel. Describe Requirements, Architecture, and an implementation Backlog; include acceptance criteria and links from stories to their source requirements.

### B. Small bookstore inventory and reorder

An independent bookstore needs a web tool to track stock for one physical shop. Staff can add a title/ISBN, record stock received and stock sold, see current on-hand quantity, and correct a counting error with a reason. The manager can set a reorder threshold per title and see a list of titles at or below threshold. A proposed purchase order can be drafted from that list and reviewed before it is marked sent; no supplier integration or automatic purchasing is required. Stock must not go below zero from a sale. Changes to quantity need an audit trail. Assume one location and one currency; no point-of-sale integration. Describe Requirements, Architecture, and an implementation Backlog; include acceptance criteria and links from stories to their source requirements.

### C. Volunteer event signup

A community group needs a web tool for volunteers to register for shifts at one-day events. Organizers can create events, shifts with a capacity and start/end time, and a short public description. Volunteers can view open shifts, sign up, withdraw, and receive an email confirmation. The tool must prevent a shift from exceeding capacity when signups arrive concurrently. Organizers can see a roster and a waitlist; when a place opens, the first waitlisted volunteer is offered the place and must accept it within 24 hours before the next person is offered it. Keep a record of signup and offer changes. Assume no payments or background checks. Describe Requirements, Architecture, and an implementation Backlog; include acceptance criteria and links from stories to their source requirements.

## Fixed structured template for the manual condition

Use this exact section structure for each brief. The author may add rows, but may not remove sections. Do not copy Throughline output into the template. Start the timer when the author first reads the brief; stop when the author declares the three deliverables ready for review. Log interruptions separately.

1. **Requirements:** numbered `R-##` rows with title, actor, behavior, business rule/constraint, priority (`must`/`should`), and testable acceptance criteria in Given/When/Then or an equally observable form. Include explicit exclusions and assumptions.
2. **Architecture:** numbered `AD-##` decisions with concern, selected approach, reason/tradeoff, and `R-##` references. Include data model, concurrent writes, permissions, notifications, and auditability where relevant.
3. **Backlog:** numbered `S-##` implementation stories with actor/outcome, testable acceptance criteria, priority, and source `R-##` references. Include enough work to realize each must requirement; a story may reference more than one requirement.
4. **Coverage and impact worksheet:** list each must requirement and its implementing story IDs or mark `uncovered`; list each architecture decision and its requirement IDs. After the specified change, identify potentially affected architecture decisions and stories and explain the source-to-dependent path. Record review time separately from authoring time.

## Fixed review checklist and scoring

Apply this rubric to the frozen output snapshot from each condition. The same evaluator reviews both; use the brief and this preregistration as the answer key, without asking the generation system for the correct answer. Save raw outputs, timestamps, screenshots/exports, and reviewer notes. A score records what is present in the output, not what the tool could have produced after extra prompting. Any remedial regeneration or editing is timed and documented as part of the condition.

| Measure | Fixed rule for each condition |
|---|---|
| Completion time | Wall-clock minutes from first exposure to the brief until Requirements, Architecture, and Backlog are complete and reviewable. Record start/end in UTC, interruptions, active minutes, generation waits, and reviewer time separately. If a condition cannot finish, record elapsed time and `incomplete`. |
| Requirements completeness | For each case-specific required concept below, score `1` only if an explicit, actionable requirement covers it; otherwise `0`. Report `covered / total` and list missing concepts. An architecture decision or story alone does not satisfy this measure. |
| Acceptance-criteria completeness | For every produced functional requirement and implementation story, score `complete` only if its criteria identify an observable action, condition, and expected outcome, including the relevant business rule when applicable. Report complete/total separately for requirements and stories; count missing criteria in the denominator. Do not score headings, assumptions, or exclusions as functional items. |
| Traceability coverage | For each produced implementation story, count whether every claimed source ID resolves to an actual requirement and whether at least one valid source relationship is semantically supported. Report valid-linked stories / all stories, unresolved or semantically invalid links, and the number of missing/invalid links surfaced as warnings by the condition. A story with no source fails. Also record architecture-to-requirement link validity separately. |
| Backlog coverage | For each **must** concept in the case-specific list, count whether at least one story explicitly implements it or the output explicitly flags it as uncovered. Report implemented / total, explicitly uncovered / total, silently uncovered / total. A general platform/setup story cannot cover a domain behavior without saying how. |
| Change-impact accuracy | Use the predeclared change and answer key below. On the saved pre-change output, map generated items to the answer-key concepts **before** applying the change; save this mapping. After the change, count true affected items surfaced, affected items missed, and unaffected items incorrectly flagged. Record ambiguous mappings and any answer-key concept absent from the output as `not instantiated`, not as a true negative. Inspect both direct and transitive effects where present. |
| Explainability | For every surfaced impact warning, mark `inspectable` only if the reviewer can see the changed source and an actual dependency path/reason to the flagged item. Report inspectable/total warnings and a short example or missing information. Record minutes from opening the impact view to the reviewer being able to state the affected set and why; if impossible, record elapsed time and `unresolved`. |

Reviewer process: first record raw item counts and the pre-change mapping; then score completeness, criteria, traceability, and backlog coverage without altering outputs; then apply the controlled change and score impact. Preserve an item-by-item scoring sheet with a brief reason for each `0`, missing link, false positive, or ambiguous mapping. For the manual template, the author completes its worksheet after receiving the change; the evaluator applies the same truth set. For Throughline, use the hosted Requirements → Architecture → Backlog workflow with approvals needed to reach the next stage. Time those steps. Do not silently supplement output from the evaluator's knowledge.

### Case-specific required concepts

Each bullet is one scoring unit. Requirements completeness denominator and backlog coverage denominator are fixed at **8 per case**. The last bullet in each case is an explicit safeguard or constraint, not optional polish.

| Case | Eight must concepts |
|---|---|
| A | patient views slots by clinician/date; patient requests a slot; patient cancels/reschedules; staff publishes/blocks availability; one confirmed booking per slot under concurrent requests; email confirmation; staff daily schedule; booking-change audit trail |
| B | staff adds title/ISBN; staff records receipt; staff records sale; on-hand quantity view; count correction with reason; threshold per title and at/below list; manager-reviewed draft purchase order before sent; prevent negative stock and audit quantity changes |
| C | organizer creates event; organizer defines timed shift/capacity; volunteer views open shifts; volunteer signs up/withdraws; concurrency-safe capacity; organizer roster; ordered waitlist and 24-hour acceptance offer; email confirmation and signup/offer audit trail |

## Predeclared upstream changes and answer keys

These are semantic answer keys, written before the generated items exist. Each key distinguishes domain effects from unrelated items. The evaluator will map actual pre-change item IDs to the listed concepts before applying the change; that saved mapping is the operational answer key for item counts. The mapping may not be changed after impact output is viewed. Where generation omits or combines concepts, record the omission or combination; do not invent an item. A downstream item is truly affected if its behavior or chosen design must change to satisfy the new rule, even if the system lacks a recorded dependency edge. A mere shared artifact type is insufficient.

### A: appointment cancellation window

**Change stimulus:** Patients may cancel or reschedule only until **24 hours before** the scheduled start. Reception staff may still cancel or reschedule at any time. All other brief rules remain.

**Expected affected concepts:** cancellation/rescheduling requirement and its criteria; patient-facing cancellation/rescheduling story and eligibility/error handling; architecture decision or data/API design that enforces booking modification authorization using appointment start time and actor role. A notification story/decision is affected **only if** it describes cancellation or rescheduling messages or their timing. The change may propagate from requirement to architecture to story through those concepts.

**Expected unaffected concepts:** slot browsing, availability publishing/blocking, booking concurrency/uniqueness, staff daily schedule, and booking audit trail except an item that explicitly encodes the former unrestricted patient modification rule. New appointment request and initial confirmation behavior remain unchanged. An item that bundles changed and unchanged behavior is classified affected and noted as bundled.

### B: reorder threshold scope

**Change stimulus:** The reorder threshold is changed from a per-title value to a **single shop-wide threshold of 5 units**, applied uniformly to all titles. The manager may change that one threshold. All other brief rules remain.

**Expected affected concepts:** threshold and at/below list requirement; threshold-setting and low-stock-list stories; architecture/data design storing or querying per-title thresholds, including low-stock calculation; purchase-order draft selection **only if** it uses the low-stock list as its source. Propagation follows the threshold rule to list/query behavior and any draft derived from it.

**Expected unaffected concepts:** title/ISBN catalog, receipt, sale, on-hand arithmetic, count correction and its reason, negative-stock guard, and quantity audit. A purchase-order review/send action that is independent of candidate selection is unaffected; a bundled story is affected and noted as bundled.

### C: waitlist offer expiry

**Change stimulus:** A volunteer has **12 hours**, instead of 24, to accept a waitlist offer. Offer order and all other brief rules remain.

**Expected affected concepts:** waitlist acceptance-window requirement/criteria; offer-expiry scheduling or data/API design; offer-acceptance and expiry/next-person stories; email text or timing **only if** it states the expiry window. Propagation follows the requirement to expiry handling and offer acceptance.

**Expected unaffected concepts:** event creation, shift scheduling, open-shift browsing, capacity-safe direct signup, roster, withdrawal itself, FIFO waitlist ordering, and initial signup confirmation. A bundled story is affected and noted as bundled.

## Run log and results

Pending coordinator registration. No sample projects have been created or mutated for E6-S5. For each case and condition, append the UTC timeline, output links/exports, item-by-item scoring sheet, pre-change item mapping, change action, impact view evidence, and metric table. Keep failed or incomplete runs in the record.

| Case | Condition | Start/end UTC | Active minutes | Outputs/evidence | Score sheet | Controlled-change evidence | Notes |
|---|---|---|---:|---|---|---|---|
| A | AI-assisted template proxy | pending | pending | pending | pending | pending | pending |
| A | Throughline hosted | pending | pending | pending | pending | pending | pending |
| B | AI-assisted template proxy | pending | pending | pending | pending | pending | pending |
| B | Throughline hosted | pending | pending | pending | pending | pending | pending |
| C | AI-assisted template proxy | pending | pending | pending | pending | pending | pending | pending |
| C | Throughline hosted | pending | pending | pending | pending | pending | pending |

## Reporting limitations to carry into E6-S6

Exploratory `n = 3`; likely one reviewer and a developer/evaluator; small capstone setting; no product-market-fit claim. Report negative findings and missing data. If AI authors the template, the comparison measures a structured AI-assisted proxy, not human manual work. Any hosted-product gaps or incomplete runs must remain visible in the result table.
