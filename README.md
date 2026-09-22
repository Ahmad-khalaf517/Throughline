# Throughline

AI-assisted project scaffolding tool with deterministic lineage tracking (see
`docs/Throughline_BRD.md`). This repo is the implementation; the design docs
in `docs/` are the source of truth and are kept current after every decision.

- `docs/Throughline_BRD.md` - business requirements
- `docs/Throughline_ERD.md` - data model (**frozen**), decision log
- `docs/Throughline_Technical_Requirements_Lineage_Invariants.md` - functional/non-functional requirements
- `docs/Throughline_Module_Boundaries.md` - module map, layering, ownership
- `docs/Throughline_Project_Setup.md` - this repo's setup, config and dependency plan

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in real values
pnpm dev
```

See `docs/Throughline_Project_Setup.md` section 10 for the full slice-1 setup
sequence and section 8 for all `pnpm` scripts.

## Conventions

- Husky + lint-staged run on commit/push; `pnpm format` / `pnpm lint` run the
  same checks by hand.
- Module boundaries (`docs/Throughline_Module_Boundaries.md`) are enforced by
  `eslint-plugin-boundaries` in `eslint.config.mjs` - a lint failure there is a
  design violation, not a false positive.
- Never run `drizzle-kit push`. Only `generate` and `migrate` (ERD section 2.1).
