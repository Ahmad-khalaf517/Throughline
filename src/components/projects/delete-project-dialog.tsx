'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, TriangleAlert } from 'lucide-react';

interface DeleteProjectButtonProps {
  projectId: string;
  projectName: string;
}

/**
 * The project header's "Delete project" control: a button that opens a
 * type-the-name confirmation. Deleting is permanent (`DELETE
 * /api/projects/:projectId` removes the project and all of its Throughline
 * data), so the dialog only enables its confirm button once the user has typed
 * the project's exact name.
 */
export function DeleteProjectButton({ projectId, projectName }: DeleteProjectButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Hand focus back to what opened the dialog, so a keyboard user is not
    // dropped at the top of the page.
    triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Delete project"
        className="border-error/40 text-error hover:bg-error-container focus-visible:ring-error flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Trash2 className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Delete project</span>
      </button>
      {/* Portalled to <body>: this button sits inside the project header, a
          sticky z-30 stacking context, which would otherwise trap the overlay
          beneath the z-40 top navbar instead of covering it. */}
      {open &&
        createPortal(
          <DeleteProjectDialog projectId={projectId} projectName={projectName} onClose={close} />,
          document.body,
        )}
    </>
  );
}

interface DeleteProjectDialogProps extends DeleteProjectButtonProps {
  onClose: () => void;
}

/**
 * Minimal self-contained modal - no dialog primitive exists in this codebase
 * yet, so this mirrors `edit-profile-dialog.tsx` / `review/item-edit-dialog.tsx`:
 * focus-trapped, `Escape`/backdrop-click cancel, initial focus on the input
 * (screen-kit skill's keyboard-operability bar). It is an `alertdialog`
 * because it interrupts to ask for a destructive decision.
 *
 * While the request is in flight nothing can dismiss it: a delete that has
 * been sent cannot be recalled, and closing the dialog mid-request would hide
 * its outcome.
 */
function DeleteProjectDialog({ projectId, projectName, onClose }: DeleteProjectDialogProps) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Surrounding whitespace is invisible in the header and easy to lose when
  // copying a name, so it is not part of what must match; case and inner
  // characters are.
  const matches = confirmation.trim() === projectName.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!pending) onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
  }, [onClose, pending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches || pending) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });

      if (response.status === 401) {
        // Session expired between page load and submit.
        router.push('/sign-in');
        return;
      }

      // 404 means the project is already gone (deleted in another tab, or a
      // concurrent request won) - the outcome the user wanted, so treat it as done.
      if (response.status !== 204 && response.status !== 404) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not delete the project. Please try again.');
        setPending(false);
        return;
      }

      // Leave `pending` set: the dialog stays in its "Deleting…" state until
      // the navigation unmounts it, rather than flashing back to an armed
      // confirm button for a project that no longer exists.
      router.push('/projects');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <div
      className="bg-inverse-surface/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      // Backdrop click cancels - guarded so a click starting inside the
      // dialog and bubbling up (event.target still the dialog) doesn't.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        aria-describedby="delete-project-description"
        className="bg-surface-container-lowest border-surface-dim w-full max-w-md rounded-xl border p-6 shadow-lg"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="bg-error-container text-on-error-container flex size-9 shrink-0 items-center justify-center rounded-full"
          >
            <TriangleAlert className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="delete-project-title" className="text-on-surface text-lg font-semibold">
              Delete this project?
            </h2>
            <div
              id="delete-project-description"
              className="text-on-surface-variant mt-1 flex flex-col gap-2 text-sm leading-relaxed"
            >
              <p>
                This permanently deletes{' '}
                <span className="text-on-surface font-semibold break-words">{projectName}</span> and
                everything in it from Throughline: every artifact version, item, dependency,
                approval, warning and export record. This cannot be undone.
              </p>
              <p>
                Anything already created on GitHub, Jira or Stitch is not deleted - only
                Throughline&apos;s record of it is.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          <label
            htmlFor="delete-project-confirm"
            className="text-on-surface flex flex-col gap-1.5 text-sm font-medium"
          >
            <span>
              To confirm, type <span className="font-mono-code break-all">{projectName}</span>
            </span>
            <input
              id="delete-project-confirm"
              ref={inputRef}
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={pending}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-error focus:ring-error mt-1 w-full rounded-lg border px-3.5 py-2.5 text-sm font-normal transition-colors focus:ring-1 focus:outline-none disabled:opacity-60"
            />
          </label>

          {error && (
            <p
              role="alert"
              className="bg-error-container text-on-error-container rounded-lg p-3 text-sm"
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!matches || pending}
              className="bg-error text-on-error hover:bg-error/90 focus-visible:ring-error flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {pending ? 'Deleting…' : 'Delete project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
