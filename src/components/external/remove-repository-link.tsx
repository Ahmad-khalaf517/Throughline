'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Unlink } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  describeUnlinkError,
  githubRepositorySettingsUrl,
  type ExistingRepository,
} from '@/lib/external-preview';

const LINK_CLASSNAME =
  'text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded-sm font-medium underline focus-visible:ring-2 focus-visible:outline-none';

/** The repository as the removal reported it (`removed` in the 200 body). */
export interface RemovedRepository {
  name: string | null;
  url: string | null;
}

/** "Open repository settings" - only rendered for a valid https github.com repository URL. */
function SettingsLink({ repositoryUrl }: { repositoryUrl: string | null }) {
  const settingsUrl = githubRepositorySettingsUrl(repositoryUrl);
  if (!settingsUrl) return null;
  return (
    <a href={settingsUrl} target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>
      Open repository settings
      <span className="sr-only"> (opens GitHub in a new tab)</span>
    </a>
  );
}

interface RemoveRepositoryLinkDialogProps {
  projectId: string;
  repository: ExistingRepository;
  onClose: () => void;
  /** Called once the link is gone (removed now, or already removed elsewhere). */
  onRemoved: (removed: RemovedRepository) => void;
}

/**
 * Confirm dialog for `DELETE /api/projects/:projectId/github` (FR-091, UC-S10).
 * It must say, before anything happens, that only Throughline's link is
 * removed and the repository stays on GitHub.
 */
export function RemoveRepositoryLinkDialog({
  projectId,
  repository,
  onClose,
  onRemoved,
}: RemoveRepositoryLinkDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = repository.name ?? 'this repository';

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, { method: 'DELETE' });
      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }
      // 404 = nothing is linked any more (another tab): the wanted outcome.
      if (response.status === 404) {
        onRemoved({ name: repository.name, url: repository.url });
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        removed?: { name?: string | null; url?: string | null };
        error?: { code?: string };
      } | null;
      if (!response.ok) {
        setError(describeUnlinkError(body?.error?.code));
        setPending(false);
        return;
      }
      onRemoved({
        name: body?.removed?.name ?? repository.name,
        url: body?.removed?.url ?? repository.url,
      });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <ConfirmDialog
      idPrefix="remove-repository-link"
      title="Remove this repository from Throughline?"
      icon={Unlink}
      confirmLabel="Remove link"
      pendingLabel="Removing…"
      pending={pending}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <p>
        This only removes the link in Throughline. The repository{' '}
        <strong className="font-mono-code text-on-surface font-medium break-all">{label}</strong>{' '}
        will <strong className="text-on-surface font-medium">still exist on GitHub</strong> -
        Throughline will not delete it.
      </p>
      <p>
        Delete it yourself on GitHub if you no longer need it.{' '}
        <SettingsLink repositoryUrl={repository.url} />
      </p>
      <p>
        After removing the link you can create a new repository for this project. A new repository
        cannot reuse this name while the old one still exists on GitHub.
      </p>
    </ConfirmDialog>
  );
}

interface RepositoryRemovedCardProps {
  removed: RemovedRepository;
  onCreateNew: () => void;
}

/**
 * Shown in place of the "already has a repository" card after the link was
 * removed. Takes focus on mount (the button that opened the dialog is gone).
 */
export function RepositoryRemovedCard({ removed, onCreateNew }: RepositoryRemovedCardProps) {
  const headingRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      role="status"
      className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-6"
    >
      <p
        ref={headingRef}
        tabIndex={-1}
        className="text-on-surface text-sm font-medium focus:outline-none"
      >
        Repository link removed.
      </p>
      <p className="text-on-surface-variant text-sm leading-relaxed">
        {removed.name ? (
          <>
            <span className="font-mono-code break-all">{removed.name}</span> still exists on GitHub
          </>
        ) : (
          'The repository still exists on GitHub'
        )}{' '}
        - Throughline did not delete it. Delete it there yourself if you no longer need it.{' '}
        <SettingsLink repositoryUrl={removed.url} />
      </p>
      <p className="text-on-surface-variant text-xs">
        A new repository cannot reuse the old name while the old one still exists on GitHub.
      </p>
      <div>
        <button
          type="button"
          onClick={onCreateNew}
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Create a new repository
        </button>
      </div>
    </div>
  );
}
