'use client';

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ItemVersionDTO } from '@/lib/serialize';
import {
  buildUpdatedPayload,
  ItemEditConfirmationRequired,
  readEditableField,
  type ChangedRef,
} from './item-edit-model';

interface ItemEditDialogProps {
  versionId: string;
  item: ItemVersionDTO;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>, confirmed: boolean) => Promise<ItemVersionDTO>;
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
export function ItemEditDialog({ versionId, item, onCancel, onSave }: ItemEditDialogProps) {
  const initial = readEditableField(item);
  const [text, setText] = useState(initial.text);
  const [changedRefs, setChangedRefs] = useState<ChangedRef[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  function buildPayload(): Record<string, unknown> {
    return buildUpdatedPayload(item.payload, initial.field, text);
  }

  async function handlePreview() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/artifact-versions/${versionId}/items/${item.logicalItemId}/edit/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload: buildPayload() }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not preview this edit.');
      setChangedRefs(body.changedRefs ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the server.');
    } finally {
      setPending(false);
    }
  }

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      await onSave(buildPayload(), refs.length > 0);
    } catch (cause) {
      if (cause instanceof ItemEditConfirmationRequired) {
        // The server's recomputed rebind changed references the preview had
        // not shown (or was never run against) - surface its diff so
        // "Confirm & Save" becomes available and re-sends with confirmed=true.
        setChangedRefs(cause.changedRefs);
        setError(
          'Upstream references changed since the preview - review the change below and confirm.',
        );
        setPending(false);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not save this edit.');
      setPending(false);
    }
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
          {initial.label}
          <textarea
            id="item-edit-text"
            ref={textRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:ring-primary mt-1 min-h-44 w-full resize-none rounded-lg border px-3.5 py-3 text-sm font-normal transition-colors focus:ring-1 focus:outline-none"
          />
        </label>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={pending}
            className="border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {pending ? 'Working…' : 'Preview changes'}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-error mt-3 text-sm">
            {error}
          </p>
        )}

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
                      <span className="font-mono-code font-semibold">{item.displayKey}</span>{' '}
                      depends on{' '}
                      <span className="font-mono-code font-semibold">{ref.displayKey}</span>, which
                      now has a newer approved version - saving will rebind it to the current
                      version.
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
            disabled={pending}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Cancel
          </button>
          {hasPreviewed && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={pending}
              className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {pending ? 'Saving…' : hasChanges ? 'Confirm & Save' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
