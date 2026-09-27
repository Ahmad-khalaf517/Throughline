'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, Pencil } from 'lucide-react';
import { EditProfileDialog, type UpdateDisplayNameState } from './edit-profile-dialog';

interface UserMenuProps {
  displayName: string | null;
  email: string;
  // Server action references, passed down from the (app-layer) layout -
  // `components` may not import from `app` directly (Module Boundaries;
  // enforced by boundaries/element-types).
  signOutAction: () => Promise<void>;
  updateDisplayNameAction: (
    prevState: UpdateDisplayNameState,
    formData: FormData,
  ) => Promise<UpdateDisplayNameState>;
}

// Falls back to splitting the email's local part when there's no display
// name yet, so initials read as "KA" rather than the whole address's first
// two characters.
function initialsOf(name: string): string {
  const base = name.includes('@') ? name.slice(0, name.indexOf('@')) : name;
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
export function UserMenu({
  displayName,
  email,
  signOutAction,
  updateDisplayNameAction,
}: UserMenuProps) {
  const name = displayName ?? email;
  const [open, setOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
          {initialsOf(name)}
        </span>
        <span className="text-on-surface-variant hidden max-w-32 truncate text-xs sm:block">
          {name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="border-surface-dim bg-surface-container-lowest absolute top-full right-0 z-50 mt-2 w-56 rounded-lg border shadow-lg"
        >
          <div className="border-surface-dim border-b px-3 py-2.5">
            <p className="text-on-surface truncate text-sm font-medium">{name}</p>
            <p className="text-on-surface-variant truncate text-xs">{email}</p>
          </div>
          <div className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setEditingProfile(true);
              }}
              className="text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:ring-primary flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit profile
            </button>
            <form action={signOutAction}>
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
        </div>
      )}

      {editingProfile && (
        <EditProfileDialog
          currentDisplayName={displayName}
          updateDisplayNameAction={updateDisplayNameAction}
          onClose={() => setEditingProfile(false)}
        />
      )}
    </div>
  );
}
