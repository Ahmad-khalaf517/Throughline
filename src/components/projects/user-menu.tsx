'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';

interface UserMenuProps {
  /** `app_user.displayName` - `null` when the signup flow never set one (genuinely null for at least one real account). */
  displayName: string | null;
  email: string;
  // A server action reference, passed down from the (app-layer) layout -
  // `components` may not import from `app` directly (Module Boundaries;
  // enforced by boundaries/element-types).
  signOutAction: () => Promise<void>;
}

/**
 * `displayName ?? friendlyNameFromEmail(email)` used to be the caller's job
 * (`projects/layout.tsx` pre-merged `appUser?.displayName ?? user.email`),
 * which meant a `null` displayName fell all the way back to a raw email
 * address in the header. Splitting the local part on `.`/`_`/`-` and
 * title-casing each piece turns `kassem.amin22` into "Kassem Amin22" - not
 * perfect, but a name-shaped label instead of a raw address.
 */
function friendlyNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || email
  );
}

// `label` is `displayName ?? friendlyNameFromEmail(email)` - when it's still
// an email-shaped fallback, split on the local part so initials read as "KA"
// rather than the whole address's first two characters.
function initialsOf(label: string): string {
  const base = label.includes('@') ? label.slice(0, label.indexOf('@')) : label;
  const parts = base.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const second = parts.length > 1 ? parts[1]!.charAt(0) : (parts[0]!.charAt(1) ?? '');
  return (first + second).toUpperCase();
}

/**
 * Avatar + name trigger for the dashboard shell header, opening a small menu
 * with the full name/email (the header's own label truncates) and sign out.
 * No dropdown-menu primitive exists in this codebase yet, so this is a
 * minimal self-contained popover - same reasoning as review/item-edit-dialog.tsx's
 * hand-rolled dialog: Escape and outside-click close it, focus returns to the
 * trigger on close (screen-kit skill's keyboard-operability bar).
 */
export function UserMenu({ displayName, email, signOutAction }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = displayName ?? friendlyNameFromEmail(email);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="hover:bg-surface-container-low focus-visible:ring-primary flex items-center gap-2 rounded-full py-1 pr-2 pl-1 focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="bg-surface-container-highest text-on-surface flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
          {initialsOf(label)}
        </span>
        <span className="text-on-surface-variant hidden max-w-32 truncate text-xs sm:block">
          {label}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="border-surface-dim bg-surface-container-lowest absolute top-full right-0 z-50 mt-2 w-56 rounded-lg border shadow-lg"
        >
          <div className="border-surface-dim border-b px-3 py-2.5">
            <p className="text-on-surface truncate text-sm font-medium">{label}</p>
            <p className="text-on-surface-variant truncate text-xs">{email}</p>
          </div>
          <form action={signOutAction} className="p-1">
            <button
              type="submit"
              role="menuitem"
              className="text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:ring-primary flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
