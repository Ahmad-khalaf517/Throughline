import { describe, expect, it } from 'vitest';
import {
  buildUpdatedPayload,
  ItemEditConfirmationRequired,
  readEditableField,
  type ChangedRef,
} from '@/components/review/item-edit-model';

// Payloads shaped like the real item schemas in `src/artifact-types/*/index.ts`
// (extra keys included on purpose - the dialog must read one field and leave
// the rest alone).
const requirementPayload = {
  type: 'functional',
  actor: 'Reviewer',
  behavior: 'The reviewer can approve a draft version.',
  constraints: ['Only while status is draft'],
  acceptanceCriteria: ['Approving flips the status to approved'],
  dimension: null,
  value: null,
  explanation: 'Core review flow.',
};

const uiRequirementPayload = {
  screenOrFlow: 'Artifact review',
  interactionRequirement: 'Edit opens a dialog focused on the text field.',
  responsiveConstraints: ['Dialog fits a 360px viewport'],
  accessibilityConstraints: ['Escape cancels'],
  explanation: 'Keyboard-first editing.',
};

const epicPayload = {
  title: 'Review workflow',
  scopeStatement: 'Everything a reviewer does before approving.',
  explanation: 'Groups the review stories.',
};

const storyPayload = {
  userValueStatement: 'As a reviewer I can edit an item.',
  acceptanceCriteria: ['Edit creates a new version'],
  structuredBehavior: 'Given a draft item, when saved, then a new revision is stored.',
  priority: null,
  upstreamRefs: [],
  explanation: 'Manual edit.',
};

describe('readEditableField', () => {
  it('reads a requirement behavior', () => {
    expect(readEditableField({ itemType: 'requirement', payload: requirementPayload })).toEqual({
      field: 'behavior',
      label: 'Behavior',
      text: 'The reviewer can approve a draft version.',
    });
  });

  it('reads a ui_requirement interactionRequirement', () => {
    expect(
      readEditableField({ itemType: 'ui_requirement', payload: uiRequirementPayload }),
    ).toEqual({
      field: 'interactionRequirement',
      label: 'Interaction',
      text: 'Edit opens a dialog focused on the text field.',
    });
  });

  it('reads an epic scopeStatement', () => {
    expect(readEditableField({ itemType: 'epic', payload: epicPayload })).toEqual({
      field: 'scopeStatement',
      label: 'Scope',
      text: 'Everything a reviewer does before approving.',
    });
  });

  it('reads a story structuredBehavior', () => {
    expect(readEditableField({ itemType: 'story', payload: storyPayload })).toEqual({
      field: 'structuredBehavior',
      label: 'Behavior',
      text: 'Given a draft item, when saved, then a new revision is stored.',
    });
  });

  it("returns an empty text for the type's own field when the payload lacks it", () => {
    expect(readEditableField({ itemType: 'epic', payload: { title: 'Only a title' } })).toEqual({
      field: 'scopeStatement',
      label: 'Scope',
      text: '',
    });
    expect(readEditableField({ itemType: 'ui_requirement', payload: null })).toEqual({
      field: 'interactionRequirement',
      label: 'Interaction',
      text: '',
    });
  });

  it("keeps an empty-string value of the type's field instead of falling back", () => {
    expect(
      readEditableField({
        itemType: 'requirement',
        payload: { behavior: '', description: 'ignored' },
      }),
    ).toEqual({ field: 'behavior', label: 'Behavior', text: '' });
  });

  it('falls back to a legacy behavior/description field when the type field is missing', () => {
    expect(
      readEditableField({ itemType: 'story', payload: { description: 'Old-style description' } }),
    ).toEqual({ field: 'description', label: 'Description', text: 'Old-style description' });
    expect(
      readEditableField({ itemType: 'epic', payload: { behavior: 'Old-style behavior' } }),
    ).toEqual({ field: 'behavior', label: 'Behavior', text: 'Old-style behavior' });
  });

  it('uses the legacy behavior/description detection for an unknown item type', () => {
    expect(
      readEditableField({ itemType: 'architecture_decision', payload: { behavior: 'Some text' } }),
    ).toEqual({ field: 'behavior', label: 'Behavior', text: 'Some text' });
    expect(
      readEditableField({ itemType: 'something_new', payload: { description: 'Other text' } }),
    ).toEqual({ field: 'description', label: 'Description', text: 'Other text' });
    expect(readEditableField({ itemType: 'something_new', payload: { unrelated: 1 } })).toEqual({
      field: 'description',
      label: 'Description',
      text: '',
    });
  });
});

describe('buildUpdatedPayload', () => {
  it('changes only the edited field and preserves every other key', () => {
    const updated = buildUpdatedPayload(requirementPayload, 'behavior', 'A new behavior.');

    expect(updated).toEqual({ ...requirementPayload, behavior: 'A new behavior.' });
    // The input payload is not mutated.
    expect(requirementPayload.behavior).toBe('The reviewer can approve a draft version.');
  });

  it('does not add sourceRefVersions or any other key', () => {
    const updated = buildUpdatedPayload(storyPayload, 'structuredBehavior', 'Reworded.');

    expect(updated).not.toHaveProperty('sourceRefVersions');
    expect(Object.keys(updated).sort()).toEqual(Object.keys(storyPayload).sort());
  });

  it('adds the field when the payload did not have it, and tolerates a non-object payload', () => {
    expect(buildUpdatedPayload({ title: 'T' }, 'scopeStatement', 'New scope')).toEqual({
      title: 'T',
      scopeStatement: 'New scope',
    });
    expect(buildUpdatedPayload(null, 'behavior', 'x')).toEqual({ behavior: 'x' });
  });
});

describe('ItemEditConfirmationRequired', () => {
  it('is an Error that carries the changed refs', () => {
    const changedRefs: ChangedRef[] = [
      { logicalItemId: 'logical-1', displayKey: 'R-07', from: 'iv-old', to: 'iv-new' },
    ];

    const error = new ItemEditConfirmationRequired('Confirm the rebind.', changedRefs);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ItemEditConfirmationRequired);
    expect(error.message).toBe('Confirm the rebind.');
    expect(error.changedRefs).toEqual(changedRefs);
  });
});
