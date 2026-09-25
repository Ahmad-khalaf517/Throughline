'use client';

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ItemVersionDTO } from '@/lib/serialize';
import { previewItemEdit } from './fixtures';

interface ItemEditDialogProps {
  item: ItemVersionDTO;
  onCancel: () => void;
  /** Called with a locally-updated copy of `item` - no network call (E5-S8). */
  onSave: (updatedItem: ItemVersionDTO) => void;
}

// `previewItemEdit`'s own return type, referenced by name here for
// readability - `ItemVersionDTO.payload` (and therefore this dialog's whole
// diff shape) is generic across artifact types, same reasoning as
// `fixtures.ts`'s own defensive readers.
type ChangedRef = ReturnType<typeof previewItemEdit>[number];

// The one free-text field this dialog edits: Requirement items call it
// `behavior`, every other item type (Backlog, UI Requirement) calls it
// `description` (TR section 22's field table). Read defensively, same
// pattern as `artifact-review-screen.tsx`'s `readKnownFields` - this dialog
// only needs the one field, not the whole payload shape.
function readEditableField(payload: unknown): { field: 'behavior' | 'description'; text: string } {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record.behavior === 'string') return { field: 'behavior', text: record.behavior };
    if (typeof record.description === 'string') {
      return { field: 'description', text: record.description };
    }
  }
  return { field: 'description', text: '' };
}

// Builds the saved payload: the edited text goes into whichever field it was
// read from, and - only when a rebind was confirmed - `sourceRefVersions`
// bumps to each change's `to` value, so re-opening this dialog on the same
// item afterward shows no further diff (consistent with what a real rebind,
// which mints a new ItemVersion bound to the current upstream versions,
// would leave behind).
function buildUpdatedPayload(
  payload: unknown,
  field: 'behavior' | 'description',
  text: string,
  changedRefs: ChangedRef[],
): unknown {
  const record: Record<string, unknown> =
    typeof payload === 'object' && payload !== null
      ? { ...(payload as Record<string, unknown>) }
      : {};
  record[field] = text;
  if (changedRefs.length > 0) {
    const existingVersions =
      typeof record.sourceRefVersions === 'object' && record.sourceRefVersions !== null
        ? { ...(record.sourceRefVersions as Record<string, unknown>) }
        : {};
    for (const ref of changedRefs) {
      existingVersions[ref.displayKey] = ref.to;
    }
    record.sourceRefVersions = existingVersions;
  }
  return record;
}

/**
 * Manual item edit (E5-S8; ERD 5.3; TR FR-082) - preview the upstream-
 * reference rebind diff, then require confirmation before saving if that
 * diff is non-empty. No dialog primitive exists in this codebase yet, so
 * this mirrors `approval-dialog.tsx`'s minimal, self-contained modal:
 * focus-trapped, `Escape`/backdrop-click cancel, initial focus on the
 * editable field, full keyboard operability (screen-kit skill).
 *
 * The text edit and the rebind diff are two independent things per FR-082 -
 * `previewItemEdit` is called against `item` as handed to this dialog, never
 * against the in-progress textarea value, so editing the text does not
 * itself invalidate an already-run preview.
 *
 * "Confirm & Save" (the rebind-required path) is gated by simply not
 * rendering it until `previewItemEdit` has run at least once for this edit
 * session - functionally the same "disabled until previewed" gate as a
 * `disabled` attribute would give, without a button sitting on screen with
 * no diff yet to show.
 */
export function ItemEditDialog({ item, onCancel, onSave }: ItemEditDialogProps) {
  const initial = readEditableField(item.payload);
  const [text, setText] = useState(initial.text);
  const [changedRefs, setChangedRefs] = useState<ChangedRef[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Initial focus goes to the editable field - the primary input in this
  // dialog, same reasoning as `approval-dialog.tsx` focusing its note field.
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      // Manual focus trap - identical approach to `approval-dialog.tsx`
      // (no dialog primitive exists yet to lean on instead).
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  function handlePreview() {
    setChangedRefs(previewItemEdit(item));
  }

  function handleSave() {
    onSave({
      ...item,
      payload: buildUpdatedPayload(item.payload, initial.field, text, changedRefs ?? []),
    });
  }

  const hasPreviewed = changedRefs !== null;
  const refs = changedRefs ?? [];
  const hasChanges = hasPreviewed && refs.length > 0;

  return (
    <div
      className="bg-inverse-surface/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      // Backdrop click cancels - guarded so a click starting inside the
      // dialog and bubbling up (event.target still the dialog) doesn't.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-edit-dialog-title"
        aria-describedby="item-edit-dialog-description"
        className="bg-surface-container-lowest border-surface-dim w-full max-w-lg rounded-xl border p-6 shadow-lg"
      >
        <h2 id="item-edit-dialog-title" className="text-on-surface text-lg font-semibold">
          Edit <span className="font-mono-code">{item.displayKey}</span>
        </h2>
        <p
          id="item-edit-dialog-description"
          className="text-on-surface-variant mt-1 text-sm leading-relaxed"
        >
          Editing creates a new item version. Preview the change first - if any upstream reference
          would rebind to a newer version, you must confirm it before saving (FR-082).
        </p>

        <label
          htmlFor="item-edit-text"
          className="text-on-surface mt-5 flex flex-col gap-1.5 text-sm font-medium"
        >
          {initial.field === 'behavior' ? 'Behavior' : 'Description'}
          <textarea
            id="item-edit-text"
            ref={textRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:ring-primary mt-1 w-full resize-y rounded-lg border px-3.5 py-3 text-sm font-normal transition-colors focus:ring-1 focus:outline-none"
          />
        </label>

        <div className="mt-4">
          <button
            type="button"
            onClick={handlePreview}
            className="border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            Preview changes
          </button>
        </div>

        {hasPreviewed && (
          <div aria-live="polite">
            {hasChanges ? (
              <ul className="mt-4 flex flex-col gap-2">
                {refs.map((ref) => (
                  <li
                    key={ref.logicalItemId}
                    className="border-surface-dim bg-surface-container-low flex items-start gap-2 rounded-lg border p-3"
                  >
                    <TriangleAlert
                      className="text-primary-container mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-on-surface text-sm leading-relaxed">
                      <span className="font-mono-code font-semibold">{item.displayKey}</span> will
                      now depend on{' '}
                      <span className="font-mono-code font-semibold">
                        {ref.displayKey} {ref.to}
                      </span>{' '}
                      instead of <span className="font-mono-code font-semibold">{ref.from}</span>.
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-on-surface-variant mt-4 text-sm">
                No upstream references need rebinding.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Cancel
          </button>
          {hasPreviewed && (
            <button
              type="button"
              onClick={handleSave}
              className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {hasChanges ? 'Confirm & Save' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
