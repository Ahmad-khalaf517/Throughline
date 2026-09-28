// Pure builders for the documentation `github.initRepo` commits to a new
// repository: `README.md` (TR FR-033) and one ADR per approved architecture
// decision (FR-033/FR-034). No DB, no network - `index.ts`'s
// `writeProvenanceFiles` supplies the data and commits the result.
//
// Before this file existed each ADR was only ids plus a sentence pointing the
// reader back at the Throughline workspace, and the README carried just the
// option's summary - so a repository opened by anyone else contained no
// architecture at all. Everything below is already on the rows `initRepo`
// reads (the selected option's `stack`/`tradeoffs`, and each ADR item
// version's `payload`: title, decision, technologyOrApproach, constraints,
// significantTradeoffs - the fields `architecture-materialization` stores), so
// this adds no new read and crosses no module boundary.
//
// Payloads are read as `unknown` and picked apart by field name (the same
// approach `issue-content.ts` takes for Jira): an ItemVersion written by an
// older generation may not satisfy today's schema, and a missing field should
// drop its section, not fail the whole repository write.
import type {
  ArchitectureDecisionItem,
  SelectedArchitectureOption,
} from '@/artifact-types/architecture';

type OptionDoc = Pick<
  SelectedArchitectureOption['option'],
  'optionKey' | 'title' | 'summary' | 'stack' | 'tradeoffs'
>;

export interface SelectedForDocs {
  versionNumber: number;
  option: OptionDoc;
}

export type AdrForDocs = Pick<
  ArchitectureDecisionItem,
  'displayKey' | 'logicalItemId' | 'itemVersionId' | 'payload'
>;

export type InitializationMode = 'scaffold' | 'docs-only';

// ---------------------------------------------------------------------------
// Defensive readers.
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asText).filter((entry) => entry !== '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A markdown table cell: no pipes or line breaks that would break the row. */
function tableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

// ---------------------------------------------------------------------------
// README.
// ---------------------------------------------------------------------------

const STACK_LABELS: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  hosting: 'Hosting',
  repositoryLayout: 'Repository layout',
};

/** `someKey` -> `Some key` for stack fields beyond the five the descriptor names. */
function labelForStackKey(key: string): string {
  const known = STACK_LABELS[key];
  if (known) return known;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function stackValueText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(stackValueText).filter((part) => part !== '');
    return parts.join(', ');
  }
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

// Postgres `jsonb` does not keep key order (it sorts by length, then
// alphabetically), so the stored descriptor comes back as backend / hosting /
// database / frontend. Put the five named layers in reading order, then any
// extra keys as they came.
const STACK_ORDER = Object.keys(STACK_LABELS);

function stackTable(stack: unknown): string {
  const rows = Object.entries(asRecord(stack))
    .map(([key, value], index) => ({ key, value: stackValueText(value), index }))
    .filter(({ value }) => value !== '')
    .sort((a, b) => {
      const rank = (key: string, index: number) => {
        const known = STACK_ORDER.indexOf(key);
        return known === -1 ? STACK_ORDER.length + index : known;
      };
      return rank(a.key, a.index) - rank(b.key, b.index);
    })
    .map(({ key, value }) => [labelForStackKey(key), value] as const);
  if (rows.length === 0) return '';
  const body = rows.map(([label, value]) => `| ${tableCell(label)} | ${tableCell(value)} |`);
  return ['| Layer | Choice |', '| --- | --- |', ...body].join('\n');
}

function tradeoffLines(tradeoffs: unknown): string[] {
  if (!Array.isArray(tradeoffs)) return [];
  return tradeoffs.flatMap((entry) => {
    const { factor, assessment } = asRecord(entry) as { factor?: unknown; assessment?: unknown };
    const rawFactor = asText(factor);
    // The model writes factors lowercase ("maintainability"); read as a label.
    const factorText = rawFactor.charAt(0).toUpperCase() + rawFactor.slice(1);
    const assessmentText = asText(assessment);
    if (!factorText && !assessmentText) return [];
    return [
      factorText && assessmentText
        ? `- **${factorText}:** ${assessmentText}`
        : `- ${factorText || assessmentText}`,
    ];
  });
}

function modeNote(mode: InitializationMode): string {
  return mode === 'scaffold'
    ? "This stack matches Throughline's supported starter, but this version adds documentation only - no starter files were generated."
    : 'This repository contains documentation only - no application code was generated.';
}

export function buildReadme(args: {
  selected: SelectedForDocs;
  mode: InitializationMode;
  architectureVersionId: string;
  adrItems: AdrForDocs[];
}): string {
  const { option } = args.selected;

  const adrLines = args.adrItems.map((item) => {
    const title = asText(asRecord(item.payload).title);
    const link = `[${item.displayKey}](./docs/adr/${item.displayKey}.md)`;
    return title ? `- ${link} - ${title}` : `- ${link}`;
  });

  const sections: string[] = [
    `# ${option.title}`,
    `_Generated by Throughline (FR-033) - initialization mode: **${args.mode}**. ${modeNote(args.mode)}_`,
    asText(option.summary),
  ];

  const stack = stackTable(option.stack);
  if (stack) sections.push(`## Technology stack\n\n${stack}`);

  const tradeoffs = tradeoffLines(option.tradeoffs);
  if (tradeoffs.length) sections.push(`## Trade-offs considered\n\n${tradeoffs.join('\n')}`);

  sections.push(
    `## Architecture decisions\n\n${
      adrLines.join('\n') || '_No architecture decisions were materialized for this version._'
    }`,
  );

  sections.push(
    `## Provenance

This repository was initialized from Throughline architecture_version
\`${args.architectureVersionId}\` (v${args.selected.versionNumber}), option
\`${option.optionKey}\`. See \`docs/architecture/lineage.json\` for the
machine-readable lineage record and ownership marker (ERD 7.3).

Throughline does not import this repository's metadata back into its own
database (FR-035 - self-describing, not round-trippable): editing these
files never changes Throughline's own lineage.`,
  );

  return `${sections.filter((section) => section !== '').join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// ADR.
// ---------------------------------------------------------------------------

function bulletSection(heading: string, entries: string[]): string | null {
  if (entries.length === 0) return null;
  return `## ${heading}\n\n${entries.map((entry) => `- ${entry}`).join('\n')}`;
}

export function buildAdrDoc(
  item: AdrForDocs,
  args: { selected: SelectedForDocs; architectureVersionId: string },
): string {
  const payload = asRecord(item.payload);
  const title = asText(payload.title);
  const decision = asText(payload.decision);
  const technology = asText(payload.technologyOrApproach);

  const sections: (string | null)[] = [
    title ? `# ${item.displayKey}: ${title}` : `# ${item.displayKey}`,
    `**Status:** Approved in Throughline - part of Architecture v${args.selected.versionNumber}, option ${args.selected.option.optionKey} ("${args.selected.option.title}").`,
    decision ? `## Decision\n\n${decision}` : null,
    technology ? `## Technology / approach\n\n${technology}` : null,
    bulletSection('Constraints', asTextList(payload.constraints)),
    bulletSection('Trade-offs', asTextList(payload.significantTradeoffs)),
    // TR FR-034's YAML example also shows a `depends_on` (exact upstream
    // Requirement item versions) and `requirements_version` field. Both would
    // require reading `semantic_dependency` (owned by `identity`), which is
    // not among the narrow read exports this module is allowed - deliberately
    // NOT added here to avoid an unauthorized cross-module read. What FR-034
    // requires ("cite the exact Throughline item versions... plus the
    // artifact versions for context") is satisfied by the fields below: the
    // ADR's own exact LogicalItem/ItemVersion ids and the Architecture
    // artifact version - a deliberate, documented scope narrowing.
    `## Provenance

\`\`\`yaml
adr: ${item.displayKey}
adr_logical_item_id: ${item.logicalItemId}
adr_item_version_id: ${item.itemVersionId}
architecture_version_id: ${args.architectureVersionId}
architecture_version_number: ${args.selected.versionNumber}
selected_option: ${args.selected.option.optionKey}
\`\`\`

Generated by Throughline (FR-034). Editing this file does not change
Throughline's own record of the decision (FR-035).`,
  ];

  return `${sections.filter((section): section is string => section !== null).join('\n\n')}\n`;
}
