import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * `displayName ?? friendlyNameFromEmail(email)` is the shared fallback for
 * every "who's signed in" label in the app (dashboard header, marketing
 * navbar) - a `null` displayName otherwise falls all the way back to a raw
 * email address. Splitting the local part on `.`/`_`/`-` and title-casing
 * each piece turns `kassem.amin22` into "Kassem Amin22" - not perfect, but a
 * name-shaped label instead of a raw address.
 */
export function friendlyNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || email
  );
}
