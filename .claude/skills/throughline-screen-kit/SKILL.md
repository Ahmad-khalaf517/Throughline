---
name: throughline-screen-kit
description: Load before building or reviewing any screen, page, or component under src/app/(routes)/** or src/components/**, including the artifact review screens, the approval/override dialog, the warning panel, the dependency visualization, and any GitHub/Jira/Stitch preview screen. Triggers on screen, page, component, badge, diff, dialog, panel, status, review UI, preview, sandbox, iframe.
---

# Throughline screen kit

Design consistency and two security/correctness invariants (NFR-005, FR-085) that belong next to the visual vocabulary, because they are exactly the kind of rule that quietly goes missing when similar screens get built on different days. Source: ERD, Technical Requirements sections 25/26 and NFR-005, Project Setup D-2 (Tailwind + shadcn/ui), Jira Plan Epic 5.

Prompt every general design skill (`ui-ux-pro-max`, `emil-design-eng`, `frontend-design`) with: **dense internal data tool, not a marketing page.** The content - tables, diffs, provenance, warnings - is the product. Chrome should be quiet.

## Where the actual visual design lives

BRD section 9 rules Figma out of scope - the design source of record instead is a **Stitch project**, reached through the `mcp__stitch__*` tools:

- Project title **"Throughline Traceability Design System"** (id `10161922138198556597` at last check - if `mcp__stitch__get_project` on that id 404s, re-find it with `mcp__stitch__list_projects` filtered `view=owned` and matched by this exact title; do not fall back to a "Remix of Zenith HR & Payroll System" project if one turns up - that's an unrelated design, not this product's).
- Its `designTheme.designMd` is the actual token source: colors, the Inter/JetBrains-Mono type split, 4px-rhythm spacing, 6-8px radii, flat surfaces with hairline borders and no blur, the exact per-component specs (buttons, status badges, form inputs, modals). Pull it fresh rather than hand-copying values here - it is a living Stitch project and can change.
- `mcp__stitch__list_screens` / `get_screen` on that project has actual generated reference screens for this product, including ones labeled "Throughline - Backlog Review" and "Throughline - Project Dashboard Overview (Semantic Status Colors)" - check for one matching the screen you're building before inventing a layout from scratch.

The rules below (status vocabulary, four states, accessibility) are the invariants that hold regardless of visual restyling. The Stitch project is where the actual colors/type/spacing/component shapes come from - pull both.

## Status vocabulary - get this exactly right

`artifact_version.status` is one of exactly four values (ERD CHECK constraint): **`draft`**, **`approved`**, **`superseded`**, **`rejected`**. There is no fifth "stale" status - **do not add one, anywhere, including in a TypeScript union type or a Tailwind class name.**

"Flagged" / "impacted" is a *separate, computed-on-read* boolean-ish dimension (INV-020): it can be true for an item that is otherwise `approved`. Render it as a **distinct indicator layered on top of the status badge** - e.g. a small warning glyph next to an `approved` badge - never as a status value competing with the four real ones. Conflating them is the single most likely screen-kit bug in this project, because it reads as "just one more state" and isn't.

Every status badge and every flagged-indicator distinguishes itself by **shape or icon, not color alone** (contrast + non-color differentiation - see the accessibility section below). Four statuses plus one binary flag is five visual states minimum; do not let two of them differ only by hue.

## Every screen needs four states

Loading, empty, error, and - specific to this product - **"no impact found," which is a success state and must not look like an error or an empty state.** A user who just approved something and sees an empty-looking warning panel needs to know at a glance that nothing is wrong, not wonder whether the panel failed to load.

## The rendering rule that is security, not style (NFR-005)

Generated text - anything that came from the model - is rendered as **escaped text or sanitized Markdown, never as raw HTML.** `dangerouslySetInnerHTML` (or the equivalent) anywhere outside the sandboxed Stitch iframe is a bug, not a style choice: model output is untrusted data (NFR-005, same rule the lineage skill states for the write path - this is its UI-side twin).

## The Stitch preview is specifically sandboxed (FR-053, E5-S10)

A **separate-origin iframe**, and specifically **without `allow-same-origin`**. This is the one place in the UI where third-party-generated HTML is rendered at all, and the sandbox is the only thing standing between that and an XSS surface. Do not relax this for convenience (e.g. to let the iframe talk to the parent page) without an explicit, separately-justified reason.

## Every external-write preview shows impact before the confirm button (FR-085)

GitHub init preview, Jira export preview, Stitch generate preview: each must render the current impact warnings for the items the write would be created from, **before** the user can confirm. Creating from a flagged item is allowed - it is not blocked - but only with that warning visible and an explicit confirmation action. Three preview screens, three different stories in the Jira Plan (E5-S9 for the panel, E4-S2/S3/S4 for the underlying preview data) - the easiest way to lose this rule is to build the screens on different days and let one preview render without it. If you're building a preview screen and cannot see where the impact data comes from, stop and check `impact.getExternalDrift` before shipping the screen without it.

## The approval / approve-anyway dialog is a decision gate, not a confirm dialog

FR-083/FR-084: this dialog is where a blocked approval either gets fixed (regenerate, revise) or explicitly overridden with a **mandatory, non-empty note**. Specifically:

- Every control in it must be reachable and operable by keyboard alone - Tab order, Enter/Space to activate, Escape to cancel. This is the single highest-value accessibility check in the whole app (see below): a decision gate you cannot reach by keyboard is a broken decision gate, not a minor a11y nit.
- The override note field is required and the confirm action must be disabled (or clearly blocked, with a stated reason) until it is non-empty - this mirrors the DB's own `CHECK` that rejects an override without a note (ERD, T6).
- The blocking message names the specific item and the specific reason (Technical Requirements FR-083's own example: `"S-12 would be flagged: it depends on R-07 v2 (now v3)."`) - never a generic "cannot approve" message. This is INV-023 (inspectable path) applied to the one screen where it matters most.

## The dependency/version visualization (E5-S7)

This is a demo and comprehension feature, not a graph-editing product (Technical Requirements section 27) - do not build an interactive DAG editor. Use the `dataviz` skill for the *method* (color formula, mark specs, legend rules) but render as inline SVG - Project Setup section 4 has no charting library dependency, and none should be added for this screen. Cap the rendered graph at roughly the MVP data size Technical Requirements NFR-007 assumes; this is a comprehension aid, and a hairball of 200 nodes fails at comprehension regardless of how correct the underlying data is.

## Accessibility - the bounded four-item pass, not a WCAG programme

There is no accessibility NFR for Throughline's own UI (NFR-001..008 do not include one) - this is a deliberate 8-day scope call, not an oversight, and this skill does not expand that scope. It does hold every screen to four checks, because they are cheap and a reviewer will hit their absence immediately:

1. Every interactive control reachable and operable by keyboard - the approval dialog above all.
2. A visible focus indicator on every focusable element.
3. Status badges and flagged-indicators distinguished by more than color (shape/icon, per above).
4. Form controls have labels, and the "why is this flagged" path (the impact path from INV-023) is readable as plain text, not only as graph geometry - a screen reader is the cheapest test of whether an explanation actually explains anything (NFR-001).

Anything beyond these four is P1 for this build - note it as a known limitation (Jira Plan E6-S8) rather than partially implementing it across several screens.

## If Jira Plan 1.6 option 2 is taken

One generic, type-parameterized artifact-review screen instead of four bespoke ones (Requirements/Architecture/UI Requirements/Backlog). If you build it this way: the four status values and the flagged-indicator above are exactly the shared vocabulary that makes one generic screen possible - keep per-type differences to the item-field rendering only, not to the status/impact chrome around it.
