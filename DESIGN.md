---
version: alpha
name: Throughline
description: A quiet traceability workspace with the warmth and editorial clarity of the Throughline promotion.
colors:
  canvas: '#f8f6f2'
  paper: '#fffdfb'
  ink: '#1c1b19'
  muted: '#575751'
  border: '#e5dfd7'
  rust: '#b94726'
  rust-hover: '#a43d20'
  rust-tint: '#fbede6'
  success: '#176b43'
  success-tint: '#e7f4eb'
typography:
  sans:
    fontFamily: 'Inter, system-ui, sans-serif'
  display:
    fontFamily: 'Georgia, ui-serif, serif'
  mono:
    fontFamily: 'JetBrains Mono, ui-monospace, monospace'
rounded:
  sm: '0.375rem'
  md: '0.625rem'
  lg: '0.875rem'
spacing:
  page-max: '75rem'
  card-gap: '1rem'
components:
  shell: {}
  card: {}
  journey: {}
  field: {}
---

# Throughline design system

## Overview

### Creative North Star

The user-provided Throughline promotion is the visual reference: warm paper, dark editorial headlines, fine separators, restrained rust marks, and a visible path from brief to backlog. The product applies that language at a quieter density than the advertisement.

### Product context and register

- **Audience and job:** A project owner reviews generated planning artifacts, traces decisions, understands impact, and approves work before external handoff.
- **Locale and market:** Current UI is English; no market-specific format is inferred from the image.
- **Usage scene:** Desktop-first review with usable phone layouts for project navigation and quick inspection.
- **Register:** Hybrid. The public marketing page is expressive; `/projects/**` is a dense working tool.
- **Signature:** A five-milestone project journey on the overview, filled only from the brief and real artifact approvals. It guides attention without changing status or approval rules.
- **Restraint:** Review content, warnings, diffs, and forms stay still while a person reads or acts. Motion is limited to first view progress, entrances, and fast control feedback.
- **Anti-references:** Dashboard confetti, fake completion counts, glass overlays, animated data rows, and color-only status are excluded because they obscure lineage.
- **Token ownership:** `src/app/globals.css` is the runtime source. Its `.app-shell` variables map the promotion palette to existing Tailwind semantic names; this file records their intent and exact values. Marketing retains the root Stitch palette.

## Colors

Canvas `#f8f6f2` and paper `#fffdfb` create a quiet hierarchy. Ink `#1c1b19` carries primary text, muted `#575751` carries supporting text, and border `#e5dfd7` divides dense content. Rust `#b94726` is reserved for navigation emphasis, the next action, and the journey path; tint `#fbede6` marks selection. Success `#176b43` on `#e7f4eb` means approved or no impact found, always paired with text and an icon. Warning, error, and the four artifact statuses retain their separate semantic roles.

## Typography

Inter remains the body and control face. Georgia is restricted to major page and project headings, echoing the promotion without making tables or diffs ornamental. JetBrains Mono identifies versions, item keys, and small process labels. Labels use sentence case; utility captions may use tracked uppercase.

## Layout

The product shell uses a slim top bar, a persistent desktop project rail, and a content width of 75rem. Major pages use a header, then cards or review surfaces on a consistent 1rem gap. At narrow widths, the rail disappears and project links remain horizontally scrollable; no action is hidden only in hover. Avoid fixed-height panels for long forms and review content.

## Elevation & Depth

Paper surfaces sit on canvas with a hairline border. Hover may add a very light shadow and border change. Sticky navigation uses an opaque surface to keep controls legible. No glass, blur, or deep card stacks in working screens.

## Shapes

Controls use 0.625rem corners, content cards use 0.875rem, and small badges use 0.375rem. Connector lines and dots refer to the brand mark. Status shape and icon remain meaningful independent of hue.

## Components

### Foundational visual states

Interactive elements have visible focus rings, a deliberate hover state, and stable disabled/busy geometry. Success, warning, error, and no-impact copy remain explicit text. Loading and empty states retain the same panel geometry as their loaded surface where practical.

### Buttons and actions

Solid rust marks the one primary action in a local decision area. Secondary actions use a bordered paper surface. Destructive actions stay visibly separate. Labels describe the actual operation and do not change through the flow.

### Navigation and data display

The active section uses pale rust and a left accent on the desktop rail; route-backed project sections retain real links and `aria-current`. Cards expose the full item or project name and a clear destination. The journey uses existing version status data and never invents a fifth artifact status.

### Forms and overlays

Shared field labels, inputs, and textarea own the form chrome. Inputs use paper, a neutral border, and rust focus. Dialogs keep their current decision semantics and keyboard behavior; the promotion does not authorize changing approval or deletion flows.

### Iconography

Lucide line icons use restrained strokes near labels. Icons support text, never replace essential labels or status wording.

### Motion

Framer Motion animates the overview journey once as an explanation and the measured progress bar as state indication. Control feedback uses short CSS transitions. Transform and opacity are the default animated properties; reduced-motion users receive the complete information without travel. Routine data and decision surfaces do not loop or pulse.

### Content and data visualization

Copy names the exact artifact, item, version, and effect. Counts and progress are derived from the current project read model. The dependency graph remains an aid to understanding, accompanied by readable paths and warnings.

## Do's and Don'ts

- **Do:** Lead with the next real project step and its source.
- **Do:** Keep approval, flagging, and revision signals separate and inspectable.
- **Don't:** Award completion for a draft, or imply that a flagged item has a new status.
- **Don't:** Animate text or controls while someone is reading or deciding.
