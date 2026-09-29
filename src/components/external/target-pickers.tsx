'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { FieldShell } from '@/components/auth/field-shell';
import {
  describeTargetError,
  ownerOptionLabel,
  type PreviewConnection,
  type TargetErrorCopy,
} from '@/lib/connections-ui';

export interface ProjectTargets {
  githubOwner: string | null;
  jira: { cloudId: string; projectKey: string } | null;
}

interface ErrorBody {
  error?: { code?: string };
}

const SELECT_CLASSNAME =
  'border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary h-11 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const SAVE_CLASSNAME =
  'border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary h-11 shrink-0 rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

const CARD_CLASSNAME =
  'border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-6';

async function readCode(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return body?.error?.code;
}

/** `PATCH /api/projects/:id/targets`; resolves to the saved targets or an error copy. */
async function saveTargets(
  projectId: string,
  patch: { githubOwner: string } | { jira: { cloudId: string; projectKey: string } },
): Promise<
  | { ok: true; targets: ProjectTargets }
  | { ok: false; unauthenticated?: boolean; error: TargetErrorCopy }
> {
  try {
    const response = await fetch(`/api/projects/${projectId}/targets`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, error: describeTargetError(undefined) };
    }
    if (!response.ok) return { ok: false, error: describeTargetError(await readCode(response)) };
    const body = (await response.json()) as { targets: ProjectTargets };
    return { ok: true, targets: body.targets };
  } catch {
    return {
      ok: false,
      error: { kind: 'other', message: 'Could not reach the server. Check your connection.' },
    };
  }
}

function Feedback({ error, saved }: { error: TargetErrorCopy | null; saved: boolean }) {
  return (
    <p
      role={error ? 'alert' : 'status'}
      aria-live="polite"
      className={`flex min-h-4 items-start gap-1.5 text-xs ${
        error ? 'text-error' : saved ? 'text-success' : ''
      }`}
    >
      {error && <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />}
      {!error && saved && <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />}
      <span>{error ? error.message : saved ? 'Saved.' : ''}</span>
    </p>
  );
}

interface GithubOwnerPickerProps {
  projectId: string;
  current: string | null;
  connection: PreviewConnection | null;
  onSaved: (targets: ProjectTargets) => void;
}

/**
 * FR-088: the GitHub owner (own login or an organization) new repositories are
 * created under. Options come from `GET /api/connections/github/owners`, which
 * needs a usable connection - without one the picker just says so (the
 * connect-to-continue prompt carries the action). `TARGET_LOCKED` (an export
 * already exists) disables it with an explanation.
 */
export function GithubOwnerPicker({
  projectId,
  current,
  connection,
  onSaved,
}: GithubOwnerPickerProps) {
  const router = useRouter();
  const usable = connection?.status === 'active';
  const [owners, setOwners] = useState<{ login: string; kind: 'user' | 'org' }[] | null>(null);
  const [loadError, setLoadError] = useState<TargetErrorCopy | null>(null);
  const [selected, setSelected] = useState(current ?? '');
  const [saved, setSaved] = useState(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TargetErrorCopy | null>(null);
  const [locked, setLocked] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/connections/github/owners');
        if (response.status === 401) {
          router.push('/sign-in');
          return;
        }
        if (!response.ok) {
          if (!cancelled) setLoadError(describeTargetError(await readCode(response)));
          return;
        }
        const body = (await response.json()) as {
          owners: { login: string; kind: 'user' | 'org' }[];
        };
        if (!cancelled) setOwners(body.owners);
      } catch {
        if (!cancelled) {
          setLoadError({ kind: 'other', message: 'Could not load your GitHub owners.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [usable, router]);

  async function handleSave() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    setJustSaved(false);
    const result = await saveTargets(projectId, { githubOwner: selected });
    setPending(false);
    if (!result.ok) {
      if (result.unauthenticated) {
        router.push('/sign-in');
        return;
      }
      if (result.error.kind === 'locked') setLocked(true);
      setError(result.error);
      return;
    }
    setSaved(result.targets.githubOwner);
    setJustSaved(true);
    onSaved(result.targets);
  }

  const disabled = !usable || locked || pending || owners === null;
  const unchanged = selected === (saved ?? '');

  return (
    <div className={CARD_CLASSNAME}>
      <FieldShell
        id="github-owner"
        label="GitHub owner"
        helperText={
          locked ? undefined : 'New repositories are created under this account or organization.'
        }
      >
        <div className="flex gap-2">
          <select
            id="github-owner"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setJustSaved(false);
              setError(null);
            }}
            disabled={disabled}
            className={SELECT_CLASSNAME}
          >
            <option value="">{usable ? 'Choose an owner…' : 'Connect GitHub first'}</option>
            {/* A saved owner that is not in the list (e.g. list not loaded) stays selectable. */}
            {saved && !owners?.some((owner) => owner.login === saved) && (
              <option value={saved}>{saved}</option>
            )}
            {owners?.map((owner) => (
              <option key={owner.login} value={owner.login}>
                {ownerOptionLabel(owner)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || !selected || unchanged}
            className={SAVE_CLASSNAME}
          >
            {pending ? 'Saving…' : 'Save owner'}
          </button>
        </div>
      </FieldShell>
      {locked && (
        <p className="text-on-surface-variant text-xs leading-relaxed">
          {describeTargetError('TARGET_LOCKED').message}
        </p>
      )}
      {!usable && (
        <p className="text-on-surface-variant text-xs">
          Owners are listed once your GitHub connection is active.
        </p>
      )}
      <Feedback error={error ?? loadError} saved={justSaved} />
    </div>
  );
}

interface JiraTargetPickerProps {
  projectId: string;
  current: { cloudId: string; projectKey: string } | null;
  connection: PreviewConnection | null;
  onSaved: (targets: ProjectTargets) => void;
}

/**
 * FR-088: the Jira site, then a project on it - set together or not at all, so
 * one Save sends both. Sites come from `GET /api/connections/jira/sites`,
 * projects from `.../jira/projects?cloudId=`. `TARGET_NOT_ACCESSIBLE` is shown
 * inline; changing the target only affects new exports (existing issues are
 * never moved).
 */
export function JiraTargetPicker({
  projectId,
  current,
  connection,
  onSaved,
}: JiraTargetPickerProps) {
  const router = useRouter();
  const usable = connection?.status === 'active';
  const [sites, setSites] = useState<{ cloudId: string; url: string; name: string }[] | null>(null);
  const [projects, setProjects] = useState<{ key: string; name: string }[] | null>(null);
  const [cloudId, setCloudId] = useState(current?.cloudId ?? '');
  const [projectKey, setProjectKey] = useState(current?.projectKey ?? '');
  const [saved, setSaved] = useState(current);
  const [loadError, setLoadError] = useState<TargetErrorCopy | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TargetErrorCopy | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/connections/jira/sites');
        if (response.status === 401) {
          router.push('/sign-in');
          return;
        }
        if (!response.ok) {
          if (!cancelled) setLoadError(describeTargetError(await readCode(response)));
          return;
        }
        const body = (await response.json()) as {
          sites: { cloudId: string; url: string; name: string }[];
        };
        if (!cancelled) setSites(body.sites);
      } catch {
        if (!cancelled) setLoadError({ kind: 'other', message: 'Could not load your Jira sites.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [usable, router]);

  useEffect(() => {
    if (!usable || !cloudId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/connections/jira/projects?cloudId=${encodeURIComponent(cloudId)}`,
        );
        if (response.status === 401) {
          router.push('/sign-in');
          return;
        }
        if (!response.ok) {
          if (!cancelled) {
            setProjects([]);
            setError(describeTargetError(await readCode(response)));
          }
          return;
        }
        const body = (await response.json()) as { projects: { key: string; name: string }[] };
        if (!cancelled) setProjects(body.projects);
      } catch {
        if (!cancelled) {
          setProjects([]);
          setError({ kind: 'other', message: 'Could not load the projects on that site.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [usable, cloudId, router]);

  async function handleSave() {
    if (!cloudId || !projectKey || pending) return;
    setPending(true);
    setError(null);
    setJustSaved(false);
    const result = await saveTargets(projectId, { jira: { cloudId, projectKey } });
    setPending(false);
    if (!result.ok) {
      if (result.unauthenticated) {
        router.push('/sign-in');
        return;
      }
      setError(result.error);
      return;
    }
    setSaved(result.targets.jira);
    setJustSaved(true);
    onSaved(result.targets);
  }

  const unchanged = saved?.cloudId === cloudId && saved?.projectKey === projectKey;
  const projectsLoading = usable && cloudId !== '' && projects === null;

  return (
    <div className={CARD_CLASSNAME}>
      <FieldShell id="jira-site" label="Jira site">
        <select
          id="jira-site"
          value={cloudId}
          onChange={(event) => {
            setCloudId(event.target.value);
            setProjectKey('');
            setProjects(null);
            setJustSaved(false);
            setError(null);
          }}
          disabled={!usable || sites === null || pending}
          className={SELECT_CLASSNAME}
        >
          <option value="">{usable ? 'Choose a site…' : 'Connect Jira first'}</option>
          {current && !sites?.some((site) => site.cloudId === current.cloudId) && (
            <option value={current.cloudId}>{current.cloudId}</option>
          )}
          {sites?.map((site) => (
            <option key={site.cloudId} value={site.cloudId}>
              {site.name}
            </option>
          ))}
        </select>
      </FieldShell>

      <FieldShell
        id="jira-project"
        label="Jira project"
        helperText="Changing this only affects new exports - existing Jira issues are never moved."
      >
        <div className="flex gap-2">
          <select
            id="jira-project"
            value={projectKey}
            onChange={(event) => {
              setProjectKey(event.target.value);
              setJustSaved(false);
              setError(null);
            }}
            disabled={!usable || !cloudId || projectsLoading || pending}
            className={SELECT_CLASSNAME}
          >
            <option value="">
              {!cloudId
                ? 'Choose a site first'
                : projectsLoading
                  ? 'Loading…'
                  : 'Choose a project…'}
            </option>
            {saved &&
              saved.cloudId === cloudId &&
              !projects?.some((project) => project.key === saved.projectKey) && (
                <option value={saved.projectKey}>{saved.projectKey}</option>
              )}
            {projects?.map((project) => (
              <option key={project.key} value={project.key}>
                {project.name} ({project.key})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSave}
            disabled={!usable || !cloudId || !projectKey || unchanged || pending}
            className={SAVE_CLASSNAME}
          >
            {pending ? 'Saving…' : 'Save target'}
          </button>
        </div>
      </FieldShell>
      {!usable && (
        <p className="text-on-surface-variant text-xs">
          Sites and projects are listed once your Jira connection is active.
        </p>
      )}
      <Feedback error={error ?? loadError} saved={justSaved} />
    </div>
  );
}
