'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { TextField } from '@/components/auth/text-field';

// Structural mirror of app/actions.ts's UpdateDisplayNameState - not imported
// directly, since `components` may not depend on `app` (Module Boundaries;
// enforced by boundaries/element-types). The actual action is wired in from
// projects/layout.tsx, same as UserMenu's signOutAction prop.
export type UpdateDisplayNameState = {
  status: 'idle' | 'error' | 'success';
  message: string | null;
};

interface EditProfileDialogProps {
  currentDisplayName: string | null;
  updateDisplayNameAction: (
    prevState: UpdateDisplayNameState,
    formData: FormData,
  ) => Promise<UpdateDisplayNameState>;
  onClose: () => void;
}

const initialState: UpdateDisplayNameState = { status: 'idle', message: null };

/**
 * Minimal self-contained dialog - no dialog primitive exists in this
 * codebase yet, so this mirrors review/item-edit-dialog.tsx's approach:
 * focus-trapped, Escape/backdrop-click cancels, initial focus on the name
 * field (screen-kit skill's keyboard-operability bar).
 */
export function EditProfileDialog({
  currentDisplayName,
  updateDisplayNameAction,
  onClose,
}: EditProfileDialogProps) {
  const [state, formAction, pending] = useActionState(updateDisplayNameAction, initialState);
  const dialogRef = useRef<HTMLDivElement>(null);

  // TextField doesn't forward a ref, so focus is grabbed by id instead of a
  // ref - same initial-focus requirement as item-edit-dialog.tsx's textarea.
  useEffect(() => {
    document.getElementById('edit-profile-name')?.focus();
  }, []);

  // Closes itself once the server action reports success - the parent layout
  // re-renders with the new name via the action's own revalidatePath.
  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])',
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
  }, [onClose]);

  return (
    <div
      className="bg-inverse-surface/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-profile-dialog-title"
        className="bg-surface-container-lowest border-surface-dim w-full max-w-sm rounded-xl border p-6 shadow-lg"
      >
        <h2 id="edit-profile-dialog-title" className="text-on-surface text-lg font-semibold">
          Edit profile
        </h2>

        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <TextField
            id="edit-profile-name"
            name="name"
            label="Full name"
            required
            placeholder="Ada Lovelace"
            defaultValue={currentDisplayName ?? ''}
            errorText={state.status === 'error' ? (state.message ?? undefined) : undefined}
          />

          <div className="mt-1 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
