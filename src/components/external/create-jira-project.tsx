'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck, Plus } from 'lucide-react';
import { FieldShell } from '@/components/auth/field-shell';
import {
  connectStartHref,
  deriveProjectKey,
  describeCreateProjectError,
  jiraProjectsListHref,
  validateProjectKeyInput,
} from '@/lib/connections-ui';

export interface CreatedJiraProject {
  id: string;
  key: string;
  name: string;
}

type Template = 'scrum' | 'kanban';

const TEMPLATES: { value: Template; label: string; help: string }[] = [
  {
    value: 'scrum',
    label: 'Scrum',
    help: 'Sprints and a backlog - for teams that plan work in iterations.',
  },
  {
    value: 'kanban',
    label: 'Kanban',
    help: 'A continuous board without sprints - for a steady flow of work.',
  },
];

const INPUT_CLASSNAME =
  'border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary h-11 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY_CLASSNAME =
  'border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary inline-flex h-10 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const PRIMARY_CLASSNAME =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const LINK_CLASSNAME =
  'text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded text-sm font-medium underline focus-visible:ring-2 focus-visible:outline-none';

interface CreateJiraProjectProps {
  cloudId: string;
  /** The chosen site's URL, for the "Open Jira" link; only a safe atlassian.net URL is linked. */
  siteUrl: string | null;
  /** Keys of the projects already listed on the site, for the collision check. */
  existingKeys: readonly string[];
  /** Prefill for the Name field (the Throughline project's name). */
  defaultName: string;
  /**
   * Whether the connection holds `manage:jira-configuration`; `null` while it is still
   * being read (the form is then withheld rather than shown and refused).
   */
  canCreate: boolean | null;
  /** Where the reconnect link returns to (this screen). */
  returnTo: string;
  /**
   * Called once the project exists: the parent lists it, selects it and saves it
   * as the Throughline project's target. Resolves to an error message when that
   * last step failed, or `null` when it worked.
   */
  onCreated: (project: CreatedJiraProject) => Promise<string | null>;
  /** Re-reads the site's project list (the "Refresh list" action). */
  onRefreshList: () => void;
}

type Outcome =
  | { kind: 'created'; project: CreatedJiraProject; targetError: string | null }
  | { kind: 'admin_required' }
  | { kind: 'reconnect' }
  | { kind: 'error'; message: string };

/**
 * FR-092: create a Jira project from the guided Jira screen, next to the project
 * picker. An expander (not a modal): Name (prefilled), Key (derived from the
 * name until edited, format-checked live and against the listed projects),
 * Template. Every provider outcome maps to a fixed message - never the response
 * text (NFR-005).
 */
export function CreateJiraProject({
  cloudId,
  siteUrl,
  existingKeys,
  defaultName,
  canCreate,
  returnTo,
  onCreated,
  onRefreshList,
}: CreateJiraProjectProps) {
  const router = useRouter();
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [key, setKey] = useState(() => deriveProjectKey(defaultName));
  const [keyEdited, setKeyEdited] = useState(false);
  const [template, setTemplate] = useState<Template>('scrum');
  const [serverKeyError, setServerKeyError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const formatError = validateProjectKeyInput(key, existingKeys);
  const keyError = serverKeyError ?? (touched || key !== '' ? formatError : null);
  const nameError = name.trim() === '' ? 'Enter a project name.' : null;
  const nameTooLong = name.trim().length > 80;
  const canSubmit = !pending && !formatError && !nameError && !nameTooLong;
  const openJiraHref = jiraProjectsListHref(siteUrl);

  function handleName(value: string) {
    setName(value);
    setOutcome(null);
    if (!keyEdited) {
      setKey(deriveProjectKey(value));
      setServerKeyError(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setPending(true);
    setOutcome(null);
    setServerKeyError(null);
    try {
      const response = await fetch('/api/connections/jira/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudId, name: name.trim(), key, template }),
      });
      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        const copy = describeCreateProjectError(body?.error?.code);
        if (copy.kind === 'key_taken') setServerKeyError(copy.message);
        else if (copy.kind === 'admin_required') setOutcome({ kind: 'admin_required' });
        else if (copy.kind === 'reconnect') setOutcome({ kind: 'reconnect' });
        else setOutcome({ kind: 'error', message: copy.message });
        return;
      }
      const body = (await response.json()) as { project: CreatedJiraProject };
      const targetError = await onCreated(body.project);
      setOutcome({ kind: 'created', project: body.project, targetError });
    } catch {
      setOutcome({
        kind: 'error',
        message: 'Could not reach the server. Check your connection and try again.',
      });
    } finally {
      setPending(false);
    }
  }

  const reconnectLink = (
    <a href={connectStartHref('jira', returnTo)} className={LINK_CLASSNAME}>
      Reconnect Jira to allow creating projects
    </a>
  );

  return (
    <div className="flex flex-col gap-2">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        disabled={!cloudId}
        className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary inline-flex w-fit items-center gap-1.5 rounded text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus className="size-4" aria-hidden="true" />
        Create a new Jira project
      </button>
      {!cloudId && (
        <p className="text-on-surface-variant text-xs">Choose a site to create a project on it.</p>
      )}

      <div id={panelId} hidden={!open}>
        {open && canCreate === null && (
          <p className="text-on-surface-variant text-xs" role="status">
            Checking your Jira permissions…
          </p>
        )}

        {open && canCreate === false && <p className="text-sm">{reconnectLink}</p>}

        {open && canCreate === true && (
          <form
            onSubmit={handleSubmit}
            noValidate
            aria-label="Create a new Jira project"
            className="border-outline-variant bg-surface-container-low flex flex-col gap-4 rounded-lg border p-4"
          >
            <FieldShell
              id={`${baseId}-name`}
              label="Project name"
              errorText={
                touched && nameError
                  ? nameError
                  : nameTooLong
                    ? 'Use 80 characters or fewer.'
                    : undefined
              }
            >
              <input
                id={`${baseId}-name`}
                type="text"
                value={name}
                onChange={(event) => handleName(event.target.value)}
                maxLength={120}
                autoComplete="off"
                aria-invalid={touched && (nameError !== null || nameTooLong)}
                disabled={pending}
                className={INPUT_CLASSNAME}
              />
            </FieldShell>

            <FieldShell
              id={`${baseId}-key`}
              label="Project key"
              helperText="2-10 uppercase letters or digits, starting with a letter. Issues are numbered KEY-1, KEY-2."
              errorText={keyError ?? undefined}
            >
              <input
                id={`${baseId}-key`}
                type="text"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value.toUpperCase().trim());
                  setKeyEdited(true);
                  setServerKeyError(null);
                  setOutcome(null);
                }}
                onBlur={() => setTouched(true)}
                maxLength={10}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={keyError !== null}
                disabled={pending}
                className={`${INPUT_CLASSNAME} font-mono-code uppercase`}
              />
            </FieldShell>

            <fieldset className="flex flex-col gap-2" disabled={pending}>
              <legend className="text-on-surface text-sm font-medium">Template</legend>
              {TEMPLATES.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${baseId}-template`}
                    value={option.value}
                    checked={template === option.value}
                    onChange={() => setTemplate(option.value)}
                    className="text-primary-container focus-visible:ring-primary mt-0.5 focus-visible:ring-2 focus-visible:outline-none"
                  />
                  <span>
                    <span className="text-on-surface font-medium">{option.label}</span>
                    <span className="text-on-surface-variant block text-xs">{option.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={pending} className={PRIMARY_CLASSNAME}>
                {pending ? 'Creating…' : 'Create project'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  toggleRef.current?.focus();
                }}
                disabled={pending}
                className={SECONDARY_CLASSNAME}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div role="status" aria-live="polite" className="text-xs">
        {outcome?.kind === 'created' && (
          <p className="text-success flex items-start gap-1.5">
            <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Created {outcome.project.name} ({outcome.project.key}).{' '}
              {outcome.targetError
                ? `It could not be saved as this project's Jira target yet: ${outcome.targetError} Choose it in the list and use Save target.`
                : "It is now this project's Jira target."}
            </span>
          </p>
        )}
        {outcome?.kind === 'error' && (
          <p className="text-error flex items-start gap-1.5" role="alert">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{outcome.message}</span>
          </p>
        )}
        {outcome?.kind === 'reconnect' && (
          <p className="text-error flex flex-wrap items-start gap-x-1.5" role="alert">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {reconnectLink}
          </p>
        )}
        {outcome?.kind === 'admin_required' && (
          <div className="text-error flex flex-col gap-2" role="alert">
            <p className="flex items-start gap-1.5">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{describeCreateProjectError('JIRA_ADMIN_REQUIRED').message}</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {openJiraHref && (
                <a href={openJiraHref} target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>
                  Open Jira
                </a>
              )}
              <button type="button" onClick={onRefreshList} className={SECONDARY_CLASSNAME}>
                Refresh list
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
