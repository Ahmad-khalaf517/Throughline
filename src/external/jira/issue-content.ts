// Pure builders for the Jira issue `summary` and `description` of an exported
// Backlog Epic/Story (TR FR-071). No DB, no network - `index.ts`'s
// `sendCreateIssue` supplies the marker and posts the result.
//
// Before this file existed the export sent `summary: member.displayKey` and a
// description that was only the marker footer, so every Jira issue Throughline
// created read "E-01" / "S-04" with nothing else on it. The real content is
// already on the membership row's `payload` (ERD 5.4's projection fields for
// each type - the same names `artifact-types/backlog` reads defensively):
//   epic  = title, scopeStatement
//   story = userValueStatement, structuredBehavior, acceptanceCriteria, priority
// `explanation` is free-form model prose, not part of the semantic content, so
// it is deliberately not exported.
//
// The payload is read as `unknown` and picked apart by field name rather than
// importing `artifact-types/backlog`'s schemas: this module already depends on
// that package only through `getBacklogVersionMembers`, and a payload from an
// older ItemVersion may not satisfy today's Zod schema.

/** Jira's hard limit on the `summary` field. */
const JIRA_SUMMARY_MAX_LENGTH = 255;

type AdfInline = { type: 'text'; text: string };
type AdfNode =
  | { type: 'paragraph'; content: AdfInline[] }
  | { type: 'heading'; attrs: { level: number }; content: AdfInline[] }
  | {
      type: 'bulletList';
      content: Array<{
        type: 'listItem';
        content: Array<{ type: 'paragraph'; content: AdfInline[] }>;
      }>;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

// ADF rejects empty text nodes, so every builder below only emits a node for
// text that survived `trim()`.
function paragraph(text: string): AdfNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function heading(text: string): AdfNode {
  return { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] };
}

function bulletList(items: string[]): AdfNode {
  return {
    type: 'bulletList',
    content: items.map((text) => ({
      type: 'listItem' as const,
      content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
    })),
  };
}

/**
 * `E-01: <title>` / `S-04: <user value statement>`. The display key stays as a
 * prefix - it is what FR-074's Skip / Create New prompt and the rest of the app
 * call the item - but the summary now says what the issue is. Collapsed to one
 * line and capped at Jira's 255-character limit (a Story's full statement is
 * always repeated in the description). Falls back to the bare display key when
 * the payload has nothing usable, which is what the export sent before.
 */
export function buildIssueSummary(args: {
  itemType: 'epic' | 'story';
  displayKey: string;
  payload: unknown;
}): string {
  const payload = asRecord(args.payload);
  const headline =
    args.itemType === 'epic' ? asString(payload.title) : asString(payload.userValueStatement);
  if (!headline) return args.displayKey;

  const summary = `${args.displayKey}: ${headline}`.replace(/\s+/g, ' ');
  if (summary.length <= JIRA_SUMMARY_MAX_LENGTH) return summary;
  return `${summary.slice(0, JIRA_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Atlassian Document Format body: the item's content first, then the
 * Throughline provenance footer (`footer` - the caller's "Created by ..." line
 * and the `tl-<item_version_id>` marker, ERD 7.4's backup marker that
 * `reconcileIssue` searches for by text) unchanged, always last.
 *
 * Epic: the scope statement. Story: the user story, the behavior, an
 * "Acceptance criteria" bullet list (omitted when the Story has none - the
 * quality gate's `story_no_acceptance_criteria` already reports that, the
 * issue does not need to invent a placeholder) and the priority when set.
 */
export function buildIssueDescription(args: {
  itemType: 'epic' | 'story';
  payload: unknown;
  footer: string[];
}): { type: 'doc'; version: 1; content: AdfNode[] } {
  const payload = asRecord(args.payload);
  const content: AdfNode[] = [];

  if (args.itemType === 'epic') {
    const scope = asString(payload.scopeStatement);
    if (scope) content.push(paragraph(scope));
  } else {
    const userValue = asString(payload.userValueStatement);
    if (userValue) content.push(heading('User story'), paragraph(userValue));

    const behavior = asString(payload.structuredBehavior);
    if (behavior) content.push(heading('Behavior'), paragraph(behavior));

    const criteria = asStringArray(payload.acceptanceCriteria);
    if (criteria.length) content.push(heading('Acceptance criteria'), bulletList(criteria));

    const priority = asString(payload.priority);
    if (priority) content.push(paragraph(`Priority: ${priority}`));
  }

  for (const line of args.footer) content.push(paragraph(line));
  return { type: 'doc', version: 1, content };
}
