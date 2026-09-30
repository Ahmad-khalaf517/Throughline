'use client';

import { useEffect, useRef, useState } from 'react';
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

// Sits inside a guided-steps card, so it has no border or padding of its own.
const CARD_CLASSNAME = 'flex flex-col gap-3';

async function readCode(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return body?.error?.code;
}

/** `PATCH /api/projects/:id/targets`; resolves to the saved targets or an error copy. */
async function saveTargets(
  projectId: string,
  patch: { githubOwner: string | null } | { jira: { cloudId: string; projectKey: string } },
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

interface GithubOwnerRowProps {
  projectId: string;
  /** The project's saved owner, or `null` = the default (the connected account). */
  savedOwner: string | null;
  /** The connected account's own login - the default owner. */
  accountLogin: string | null;
  onSaved: (targets: ProjectTargets) => void;
}

/**
 * FR-088: where the repository is created. It defaults to the connected
 * account's own login, so nothing has to be chosen; "Change" expands the list
 * (`GET /api/connections/github/owners`) for an organization. Picking the
 * account's own login sends `{ githubOwner: null }` (reset to the default).
 * `TARGET_LOCKED` (a repository export already exists) removes the affordance and
 * says why; `TARGET_NOT_ACCESSIBLE` shows inline.
 */
export function GithubOwnerRow({
  projectId,
  savedOwner,
  accountLogin,
  onSaved,
}: GithubOwnerRowProps) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [owners, setOwners] = useState<{ login: string; kind: 'user' | 'org' }[] | null>(null);
  const [loadError, setLoadError] = useState<TargetErrorCopy | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TargetErrorCopy | null>(null);
  const [locked, setLocked] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);

  const effective = savedOwner ?? accountLogin;
  const isAccount =
    effective !== null &&
    accountLogin !== null &&
    effective.toLowerCase() === accountLogin.toLowerCase();

  // Owners are only listed once the user opens "Change".
  useEffect(() => {
    if (!changing || owners !== null) return;
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
  }, [changing, owners, router]);

  async function handleChange(login: string) {
    if (login === '' || pending) return;
    const own = accountLogin !== null && login.toLowerCase() === accountLogin.toLowerCase();
    setPending(true);
    setError(null);
    setJustSaved(false);
    const result = await saveTargets(projectId, { githubOwner: own ? null : login });
    setPending(false);
    if (!result.ok) {
      if (result.unauthenticated) {
        router.push('/sign-in');
        return;
      }
      if (result.error.kind === 'locked') {
        setLocked(true);
        setChanging(false);
      }
      setError(result.error);
      return;
    }
    setJustSaved(true);
    setChanging(false);
    onSaved(result.targets);
    changeRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <p className="text-on-surface">
          Repository owner:{' '}
          <strong className="font-medium">
            {effective ? `@${effective}` : 'your GitHub account'}
          </strong>{' '}
          <span className="text-on-surface-variant">
            ({isAccount || !effective ? 'your account' : 'organization'})
          </span>
        </p>
        {!locked && !changing && (
          <button
            ref={changeRef}
            type="button"
            onClick={() => {
              setChanging(true);
              setJustSaved(false);
              setError(null);
            }}
            className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Change
          </button>
        )}
      </div>

      {changing && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="github-owner" className="sr-only">
            Repository owner
          </label>
          <select
            id="github-owner"
            value={effective ?? ''}
            onChange={(event) => handleChange(event.target.value)}
            disabled={pending || owners === null}
            className={`${SELECT_CLASSNAME} max-w-xs`}
          >
            {owners === null && <option value={effective ?? ''}>Loading…</option>}
            {owners?.map((owner) => (
              <option key={owner.login} value={owner.login}>
                {ownerOptionLabel(owner)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setChanging(false)}
            disabled={pending}
            className={SAVE_CLASSNAME}
          >
            Cancel
          </button>
        </div>
      )}

      {locked && (
        <p className="text-on-surface-variant text-xs leading-relaxed">
          {describeTargetError('TARGET_LOCKED').message}
        </p>
      )}
      {!changing && !locked && !error && !justSaved && (
        <p className="text-on-surface-variant text-xs">
          Repositories are created under your own account unless you change this.
        </p>
      )}
      {!locked && <Feedback error={error ?? loadError} saved={justSaved} />}
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
        if (!cancelled) {
          setSites(body.sites);
          // Exactly one accessible site: nothing to choose. Saving stays explicit.
          if (body.sites.length === 1) setCloudId((chosen) => chosen || body.sites[0]!.cloudId);
        }
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
        if (!cancelled) {
          setProjects(body.projects);
          // Exactly one project on the site: pre-select it. Saving stays explicit.
          if (body.projects.length === 1)
            setProjectKey((chosen) => chosen || body.projects[0]!.key);
        }
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
