'use client';

import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  /** Prefix for the title / description element ids (unique per dialog kind). */
  idPrefix: string;
  title: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** The explanation under the title. May contain links and emphasis. */
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** Shown as an alert inside the dialog (a failed attempt keeps the dialog open). */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The shared destructive-confirm dialog (Disconnect, Remove repository link).
 * Rendered in a portal as an `alertdialog`; focus starts on Cancel (the safe
 * choice), Tab is trapped inside (buttons and links), Escape and a click outside
 * cancel unless a request is pending, and focus returns to the control that
 * opened it (when it still exists) on close. The caller owns the request.
 */
export function ConfirmDialog({
  idPrefix,
  title,
  icon: Icon,
  children,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!pending) onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href]',
      );
      if (!focusable || focusable.length === 0) return;
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
  }, [onCancel, pending]);

  return createPortal(
    <div
      className="bg-inverse-surface/40 fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="bg-surface-container-lowest border-surface-dim my-auto w-full max-w-md rounded-xl border p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-on-surface flex items-center gap-2 text-lg font-semibold">
          <Icon className="size-5 shrink-0" aria-hidden="true" />
          {title}
        </h2>
        <div
          id={descriptionId}
          className="text-on-surface-variant mt-2 space-y-2 text-sm leading-relaxed"
        >
          {children}
        </div>
        {error && (
          <p
            role="alert"
            className="bg-error-container text-on-error-container mt-3 rounded-lg p-3 text-sm"
          >
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="bg-error text-on-error hover:bg-error/90 focus-visible:ring-error flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
