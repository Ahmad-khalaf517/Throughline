import { describe, expect, it } from 'vitest';
import { buildIssueDescription, buildIssueSummary } from '@/external/jira/issue-content';

// FR-071: the Jira issues Throughline creates must carry the Epic/Story's own
// content, not just its display key. Regression for issues that arrived as a
// bare "E-01" / "S-04" with an empty body.

const MARKER_FOOTER = [
  'Created by Throughline from story S-04 (item_version iv-1).',
  'Throughline marker (do not remove): tl-iv-1',
];

const STORY_PAYLOAD = {
  userValueStatement: 'As a PM, I want to export the backlog, so that the team can start work.',
  structuredBehavior: 'Creates one Jira issue per approved Epic and Story.',
  acceptanceCriteria: ['Epics are created first', 'Stories are filed under their Epic'],
  priority: 'high',
  explanation: 'model prose that must not reach Jira',
};

function textOf(doc: ReturnType<typeof buildIssueDescription>): string {
  return JSON.stringify(doc);
}

describe('buildIssueSummary', () => {
  it('uses the Epic title, prefixed with the display key', () => {
    expect(
      buildIssueSummary({
        itemType: 'epic',
        displayKey: 'E-01',
        payload: { title: 'Project intake', scopeStatement: 'ignored here' },
      }),
    ).toBe('E-01: Project intake');
  });

  it('uses the Story user value statement, prefixed with the display key', () => {
    expect(
      buildIssueSummary({ itemType: 'story', displayKey: 'S-04', payload: STORY_PAYLOAD }),
    ).toBe(`S-04: ${STORY_PAYLOAD.userValueStatement}`);
  });

  it('collapses newlines and runs of whitespace to one line', () => {
    expect(
      buildIssueSummary({
        itemType: 'epic',
        displayKey: 'E-02',
        payload: { title: '  Review \n  screens\t' },
      }),
    ).toBe('E-02: Review screens');
  });

  it("caps at Jira's 255-character summary limit", () => {
    const summary = buildIssueSummary({
      itemType: 'story',
      displayKey: 'S-09',
      payload: { userValueStatement: 'word '.repeat(200) },
    });
    expect(summary).toHaveLength(255);
    expect(summary.startsWith('S-09: word')).toBe(true);
    expect(summary.endsWith('…')).toBe(true);
  });

  it.each([{}, null, undefined, 'not an object', { title: '   ' }, { title: 42 }])(
    'falls back to the bare display key when the payload has no usable title (%j)',
    (payload) => {
      expect(buildIssueSummary({ itemType: 'epic', displayKey: 'E-03', payload })).toBe('E-03');
    },
  );
});

describe('buildIssueDescription', () => {
  it('puts the Epic scope statement before the footer', () => {
    const doc = buildIssueDescription({
      itemType: 'epic',
      payload: { title: 'Project intake', scopeStatement: 'Covers brief capture.' },
      footer: MARKER_FOOTER,
    });
    expect(doc.type).toBe('doc');
    expect(doc.version).toBe(1);
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Covers brief capture.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: MARKER_FOOTER[0] }] },
      { type: 'paragraph', content: [{ type: 'text', text: MARKER_FOOTER[1] }] },
    ]);
  });

  it('renders a Story as user story, behavior, acceptance-criteria list and priority', () => {
    const doc = buildIssueDescription({
      itemType: 'story',
      payload: STORY_PAYLOAD,
      footer: MARKER_FOOTER,
    });
    const headings = doc.content.flatMap((node) =>
      node.type === 'heading' ? [node.content[0]!.text] : [],
    );
    expect(headings).toEqual(['User story', 'Behavior', 'Acceptance criteria']);

    const list = doc.content.find((node) => node.type === 'bulletList');
    expect(list).toEqual({
      type: 'bulletList',
      content: STORY_PAYLOAD.acceptanceCriteria.map((text) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    });

    const text = textOf(doc);
    expect(text).toContain(STORY_PAYLOAD.userValueStatement);
    expect(text).toContain(STORY_PAYLOAD.structuredBehavior);
    expect(text).toContain('Priority: high');
    expect(text).not.toContain('model prose');
  });

  it('always ends with the marker footer, so text-search reconciliation still finds it', () => {
    const doc = buildIssueDescription({
      itemType: 'story',
      payload: STORY_PAYLOAD,
      footer: MARKER_FOOTER,
    });
    expect(doc.content.slice(-2)).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: MARKER_FOOTER[0] }] },
      { type: 'paragraph', content: [{ type: 'text', text: MARKER_FOOTER[1] }] },
    ]);
  });

  it('omits the acceptance-criteria section and priority when a Story has none', () => {
    const doc = buildIssueDescription({
      itemType: 'story',
      payload: { ...STORY_PAYLOAD, acceptanceCriteria: [], priority: null },
      footer: MARKER_FOOTER,
    });
    const text = textOf(doc);
    expect(text).not.toContain('Acceptance criteria');
    expect(text).not.toContain('bulletList');
    expect(text).not.toContain('Priority');
  });

  it('never emits an empty text node (ADF rejects them), even for blank criteria', () => {
    const doc = buildIssueDescription({
      itemType: 'story',
      payload: { ...STORY_PAYLOAD, acceptanceCriteria: ['  ', '', 'Real criterion'] },
      footer: MARKER_FOOTER,
    });
    const texts = [...textOf(doc).matchAll(/"text":"([^"]*)"/g)].map((match) => match[1]);
    expect(texts.every((text) => text!.trim().length > 0)).toBe(true);
    expect(textOf(doc)).toContain('Real criterion');
  });

  it('degrades to the footer alone when the payload is empty (what was sent before)', () => {
    const doc = buildIssueDescription({ itemType: 'story', payload: {}, footer: MARKER_FOOTER });
    expect(doc.content).toHaveLength(2);
  });
});
