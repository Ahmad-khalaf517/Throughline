'use client';

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ItemVersionDTO } from '@/lib/serialize';

interface ApprovalDialogProps {
  /** Items with an unacknowledged `impact` row - the approval gate (FR-083). */
  blockingItems: ItemVersionDTO[];
  onCancel: () => void;
  /** Called with the trimmed, non-empty override note (FR-084). */
  onConfirm: (note: string) => void;
}

/**
 * The approve-anyway decision gate (FR-083/FR-084) - not a generic confirm
 * dialog. No dialog primitive exists in this codebase yet, so this is a
 * minimal, self-contained modal: focus-trapped, `Escape`/backdrop-click
 * cancel, initial focus on the note field, full keyboard operability
 * (screen-kit skill, "approval / approve-anyway dialog" section).
 */
export function ApprovalDialog({ blockingItems, onCancel, onConfirm }: ApprovalDialogProps) {
  const [note, setNote] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Initial focus goes to the note field, not the dialog container or the
  // first button - the note is the one required input in this dialog.
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      // Manual focus trap: no dialog primitive exists yet to lean on. Wrap
      // Tab/Shift+Tab at the dialog's own first/last focusable element so
      // focus never escapes to the page behind the backdrop.
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

  const canConfirm = note.trim().length > 0;

  return (
    <div
      className="bg-inverse-surface/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      // Backdrop click cancels - guarded so a click that starts inside the
      // dialog and bubbles up (event.target still the dialog) doesn't.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-dialog-title"
        aria-describedby="approval-dialog-description"
        className="bg-surface-container-lowest border-surface-dim w-full max-w-lg rounded-xl border p-6 shadow-lg"
      >
        <h2 id="approval-dialog-title" className="text-on-surface text-lg font-semibold">
          Approval blocked
        </h2>
        <p
          id="approval-dialog-description"
          className="text-on-surface-variant mt-1 text-sm leading-relaxed"
        >
          Regenerate, revise, or approve anyway with a note explaining why each flag below is
          acceptable (FR-083, FR-084).
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {blockingItems.map((item) => {
            const impact = item.impact;
            if (!impact) return null;
            return (
              <li
                key={item.itemVersionId}
                className="border-surface-dim bg-surface-container-low flex items-start gap-2 rounded-lg border p-3"
              >
                <TriangleAlert
                  className="text-primary-container mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <p className="text-on-surface text-sm leading-relaxed">
                  <span className="font-mono-code font-semibold">{item.displayKey}</span> would be
                  flagged: it depends on{' '}
                  <span className="font-mono-code font-semibold">{impact.rootDisplayKey}</span> (see
                  path: {impact.path.join(' → ')}).
                </p>
              </li>
            );
          })}
        </ul>

        <label
          htmlFor="override-note"
          className="text-on-surface mt-5 flex flex-col gap-1.5 text-sm font-medium"
        >
          Override note (required)
          <textarea
            id="override-note"
            ref={noteRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Explain why it's acceptable to approve with this flag present..."
            className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:ring-primary mt-1 w-full resize-y rounded-lg border px-3.5 py-3 text-sm font-normal transition-colors focus:ring-1 focus:outline-none"
          />
        </label>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(note.trim())}
            className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve anyway
          </button>
        </div>
      </div>
    </div>
  );
}
