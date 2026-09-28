// Pure logic behind `item-edit-dialog.tsx` (no React, so it is unit-testable
// without rendering): which payload field the dialog edits per item type, how
// the saved payload is built, and the error the save path raises when the
// server asks for a rebind confirmation the client had not given.

/**
 * One upstream reference that would rebind on save, as returned by
 * `POST .../edit/preview` and by a 409 `CONFIRMATION_REQUIRED`. `from`/`to`
 * are `item_version` ids - opaque to the user, so the UI only ever shows
 * `displayKey`.
 */
export type ChangedRef = { logicalItemId: string; displayKey: string; from: string; to: string };

export interface EditableField {
  /** The payload key the edited text is written back to. */
  field: string;
  /** The label shown above the textarea. */
  label: string;
  /** The current text of that field ('' when the payload has none). */
  text: string;
}

// The primary free-text field per item type, named by each artifact-type
// module's own item schema (`src/artifact-types/*/index.ts`): a Requirement's
// `behavior`, a UI Requirement's `interactionRequirement`, an Epic's
// `scopeStatement`, a Story's `structuredBehavior`. `architecture_decision`
// is never editable in a draft, so it deliberately has no entry.
const TYPE_FIELDS: Record<string, { field: string; label: string }> = {
  requirement: { field: 'behavior', label: 'Behavior' },
  ui_requirement: { field: 'interactionRequirement', label: 'Interaction' },
  epic: { field: 'scopeStatement', label: 'Scope' },
  story: { field: 'structuredBehavior', label: 'Behavior' },
};

// Field names the dialog used before it knew the real per-type fields. Kept
// as a fallback so an item whose payload predates (or does not match) its
// type's schema is still editable instead of showing an empty box.
const LEGACY_FIELDS = [
  { field: 'behavior', label: 'Behavior' },
  { field: 'description', label: 'Description' },
] as const;

/**
 * The one free-text field the edit dialog offers for `item`. Read
 * defensively - the payload is `unknown` at this layer, same pattern as
 * `artifact-review-screen.tsx`'s `readKnownFields`.
 */
export function readEditableField(item: { itemType: string; payload: unknown }): EditableField {
  const record =
    typeof item.payload === 'object' && item.payload !== null
      ? (item.payload as Record<string, unknown>)
      : {};
  const typeField = TYPE_FIELDS[item.itemType];

  if (typeField && typeof record[typeField.field] === 'string') {
    return { ...typeField, text: record[typeField.field] as string };
  }
  for (const legacy of LEGACY_FIELDS) {
    if (typeof record[legacy.field] === 'string') {
      return { ...legacy, text: record[legacy.field] as string };
    }
  }
  return { ...(typeField ?? LEGACY_FIELDS[1]), text: '' };
}

/**
 * The payload to submit: the existing one with ONLY `field` replaced by
 * `text`. No other key is added or touched - the server re-derives the
 * upstream bindings itself (`rebindDraftItem`) and stores the submitted
 * payload verbatim, so a client-side simulation of a rebind would end up as
 * stray keys in the real payload.
 */
export function buildUpdatedPayload(
  payload: unknown,
  field: string,
  text: string,
): Record<string, unknown> {
  const record: Record<string, unknown> =
    typeof payload === 'object' && payload !== null
      ? { ...(payload as Record<string, unknown>) }
      : {};
  record[field] = text;
  return record;
}

/**
 * Thrown by the save call on a 409 `CONFIRMATION_REQUIRED`: the server's
 * recomputed rebind changed references and the request was not `confirmed`.
 * Carries the server's `changedRefs` so the dialog can show them and offer
 * "Confirm & Save".
 */
export class ItemEditConfirmationRequired extends Error {
  readonly changedRefs: ChangedRef[];

  constructor(message: string, changedRefs: ChangedRef[]) {
    super(message);
    this.name = 'ItemEditConfirmationRequired';
    this.changedRefs = changedRefs;
  }
}
