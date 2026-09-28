# Case B: AI-assisted structured-template proxy

**Author:** Codex evaluation agent (GPT-6 family; exact variant not exposed), also the evaluator and preregistration author. It knew the brief, checklist, and change answer key before authoring. **Prompt:** Case B brief and fixed template in `three-brief-evaluation.md`; no Throughline output used. **Human edits:** none after this first output. **Authoring:** 2026-09-28 11:35:57–11:36:47 UTC (50 seconds, no interruption logged). This is an AI-assisted proxy, not human manual work; first-exposure timing is unavailable.

## Requirements

| ID | Actor, behavior, priority | Acceptance criteria |
|---|---|---|
| R-01 | Staff add a title with ISBN. Must. ISBN is unique. | Given staff access and a new ISBN/title, when saved, then one catalog entry appears; an existing ISBN is rejected without a duplicate. |
| R-02 | Staff record stock received. Must. Quantity is positive. | Given a title and positive received count, when staff records receipt, then on-hand increases by exactly that count and the receipt is shown in history. |
| R-03 | Staff record stock sold. Must. Sale cannot exceed on-hand. | Given a title with 2 on hand, when staff sells 2, then on-hand becomes 0; when staff attempts 3, then sale is rejected and quantity remains 2. |
| R-04 | Staff view current on-hand by title/ISBN. Must. | Given a title with receipts, sales and corrections, when staff opens inventory, then displayed on-hand equals the recorded net quantity for that title. |
| R-05 | Staff correct a count with a reason. Must. | Given a title, counted quantity and nonempty reason, when a staff member posts a correction, then on-hand equals the counted quantity and history records old/new quantity and reason; blank reason is rejected. |
| R-06 | Manager sets a reorder threshold per title and sees titles at or below it. Must. | Given a title threshold of 5, when on-hand falls to 5, then it appears on low-stock list; at 6 it does not. Given manager access, when threshold is changed for one title, then only that title's low-stock test uses the new value. |
| R-07 | Manager drafts a purchase order from low-stock list, reviews it, and marks sent. Must. No supplier integration or automatic purchase. | Given at least one low-stock title, when a draft is created, then it lists proposed lines without sending; only after manager review/confirmation can status become sent, with no supplier API call. |
| R-08 | System prevents negative sale stock and audits every quantity change. Must. | Given concurrent sales that together exceed stock, when submitted, then only sales within available quantity commit; every committed receipt, sale, or correction has actor, action, quantity delta, reason where required, and timestamp. |

Assumptions: one shop/location and one currency. Exclusions: POS integration, supplier integration, automatic purchasing, multi-location stock.

## Architecture

| ID | Concern | Decision and tradeoff | Source |
|---|---|---|---|
| AD-01 | Catalog and stock model | Relational tables for title/ISBN, per-title threshold, current stock and append-only movements. A materialized current balance makes reads cheap but requires transactional consistency with movements. | R-01, R-02, R-04, R-06, R-08 |
| AD-02 | Safe quantity writes | Process receipt/sale/correction within transactions, lock the title stock row and reject a sale if post-sale balance is negative. Row contention is accepted for one shop. | R-02, R-03, R-05, R-08 |
| AD-03 | Reorder workflow | Query `on_hand <= title.threshold`, save purchase-order drafts/lines, and require a manager transition to `sent`; there is no supplier connector. | R-06, R-07 |
| AD-04 | Permissions and audit | Staff can record movements; only managers can set thresholds or send orders. Append movement and order-status audit events with actor/time. | R-05, R-06, R-07, R-08 |

## Backlog

| ID | Story, priority | Acceptance criteria | Source |
|---|---|---|---|
| S-01 | Staff add a catalog title. Must. | Given a new ISBN/title, when saved, then one title appears; duplicate ISBN is rejected. | R-01 |
| S-02 | Staff receive stock. Must. | Given a title and positive receipt count, when saved, then on-hand rises by that count and movement history shows the receipt. | R-02, R-08 |
| S-03 | Staff sell stock. Must. | Given 2 on hand, when selling 2, then balance becomes 0; selling 3 or simultaneous excess sales is rejected without negative balance. | R-03, R-08 |
| S-04 | Staff inspect on-hand inventory. Must. | Given recorded receipts, sales and corrections, when inventory opens, then each displayed balance equals the net committed movements. | R-04 |
| S-05 | Staff correct a count. Must. | Given a counted quantity and reason, when correction commits, then balance matches the count and history shows old/new/reason/actor/time; blank reason is rejected. | R-05, R-08 |
| S-06 | Manager sets per-title reorder thresholds and views low-stock list. Must. | Given per-title thresholds, when on-hand is at/below a title's threshold, then that title appears; changing one title's threshold does not alter another's classification. | R-06 |
| S-07 | Manager drafts and reviews a purchase order. Must. | Given low-stock titles, when drafting, then lines appear in unsent status; only an explicit manager review/confirm action marks it sent, with no supplier call. | R-07 |
| S-08 | Manager/staff audit quantity and order changes. Must. | Given a committed movement or order status change, when history opens, then actor, timestamp, action and quantity/reason where applicable are visible and entries cannot be edited. | R-08, R-07 |

## Coverage and impact worksheet before change

| Must concept | Story |
|---|---|
| Catalog title/ISBN | S-01 |
| Receipt | S-02 |
| Sale | S-03 |
| On-hand view | S-04 |
| Count correction/reason | S-05 |
| Threshold/list | S-06 |
| Manager-reviewed draft order | S-07 |
| Negative-stock guard/quantity audit | S-03, S-08 |

Architecture source references appear in its table. The controlled-change worksheet is appended after the fixed stimulus is applied to this condition.
