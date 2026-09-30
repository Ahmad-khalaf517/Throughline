'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CircleCheck, Lock } from 'lucide-react';
import { DisconnectDialog } from '@/components/connections/disconnect-dialog';
import { StitchKeyForm } from '@/components/connections/stitch-key-form';
import {
  CONNECTIONS_PATH,
  connectStartHref,
  describeConnectionSteps,
  PROVIDER_LABEL,
  PROVIDER_PURPOSE,
  type ConnectionProvider,
  type ConnectionStep,
  type PreviewConnection,
} from '@/lib/connections-ui';

interface ConnectionStepsProps {
  provider: ConnectionProvider;
  connection: PreviewConnection;
  /** Relative path of this screen; OAuth returns the user here after connecting. */
  returnTo: string;
  /** Re-load the screen's preview after a connect / disconnect made from here. */
  onChanged: () => Promise<void> | void;
  /** Body of step 2 (owner row, target picker). Shown only once step 1 is done. */
  configure?: ReactNode;
}

const PRIMARY_LINK =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';
const SECONDARY_BUTTON =
  'border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const TEXT_LINK =
  'text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded text-sm font-medium focus-visible:ring-2 focus-visible:outline-none';

/**
 * The guided steps at the top of each write screen (GitHub, Jira, Stitch): step 1
 * says whether the user is connected and lets them connect, reconnect or
 * disconnect right here; the following steps show what is next and why a locked
 * one is locked. State comes from `describeConnectionSteps` (pure); status is
 * carried by an icon and words, never colour alone, and the active step has
 * `aria-current="step"`.
 */
export function ConnectionSteps({
  provider,
  connection,
  returnTo,
  onChanged,
  configure,
}: ConnectionStepsProps) {
  const label = PROVIDER_LABEL[provider];
  const steps = describeConnectionSteps(provider, connection);
  const connected = connection.status === 'active';
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  async function changed() {
    await onChanged();
    // The control that was used may be gone (Disconnect -> Connect): keep focus here.
    bodyRef.current?.focus();
  }

  return (
    <section
      aria-labelledby={`${provider}-steps-heading`}
      className="border-surface-dim bg-surface-container-lowest rounded-xl border p-5"
    >
      <h2
        id={`${provider}-steps-heading`}
        className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
      >
        {label} - {PROVIDER_PURPOSE[provider].toLowerCase()}
      </h2>

      <ol className="mt-3 flex flex-col gap-4">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step.status === 'current' ? 'step' : undefined}
            className="flex items-start gap-3"
          >
            <StepMarker step={step} number={index + 1} />
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${
                  step.status === 'locked' ? 'text-on-surface-variant' : 'text-on-surface'
                }`}
              >
                {step.label}
                {step.status === 'done' && <span className="sr-only"> (done)</span>}
                {step.status === 'current' && <span className="sr-only"> (current step)</span>}
              </p>
              {step.status === 'locked' && step.lockedReason && (
                <p className="text-on-surface-variant mt-0.5 text-xs">{step.lockedReason}</p>
              )}

              {step.id === 'connect' && (
                <div
                  ref={bodyRef}
                  tabIndex={-1}
                  className="mt-2 flex flex-col gap-2 focus:outline-none"
                >
                  {notice && (
                    <p role="status" className="text-on-surface-variant text-xs leading-relaxed">
                      {notice}
                    </p>
                  )}
                  <ConnectBody
                    provider={provider}
                    connection={connection}
                    returnTo={returnTo}
                    onDisconnect={() => setDisconnecting(true)}
                    onKeySaved={changed}
                  />
                </div>
              )}

              {step.id === 'configure' && connected && configure && (
                <div className="mt-2">{configure}</div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {disconnecting && (
        <DisconnectDialog
          provider={provider}
          onClose={() => setDisconnecting(false)}
          onDone={async (message) => {
            setDisconnecting(false);
            setNotice(message);
            await changed();
          }}
        />
      )}
    </section>
  );
}

function StepMarker({ step, number }: { step: ConnectionStep; number: number }) {
  const base =
    'mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold';
  if (step.status === 'done') {
    return (
      <span className={`${base} text-success`}>
        <CircleCheck className="size-5" aria-hidden="true" />
      </span>
    );
  }
  if (step.status === 'locked') {
    return (
      <span className={`${base} border-outline-variant text-on-surface-variant border`}>
        <Lock className="size-3" aria-hidden="true" />
        <span className="sr-only">Locked</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${base} ${
        step.status === 'current'
          ? 'bg-primary-container text-on-primary-container'
          : 'border-outline-variant text-on-surface border'
      }`}
    >
      {number}
    </span>
  );
}

function ConnectBody({
  provider,
  connection,
  returnTo,
  onDisconnect,
  onKeySaved,
}: {
  provider: ConnectionProvider;
  connection: PreviewConnection;
  returnTo: string;
  onDisconnect: () => void;
  onKeySaved: () => Promise<void>;
}) {
  const label = PROVIDER_LABEL[provider];
  const oauth = provider === 'github' || provider === 'jira';
  const connectHref = oauth ? connectStartHref(provider, returnTo) : null;

  if (connection.status === 'active') {
    const name = connection.accountName;
    const shown = name ? (provider === 'github' ? `@${name}` : name) : null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-on-surface flex min-w-0 items-center gap-1.5 text-sm">
          <CircleCheck className="text-success size-4 shrink-0" aria-hidden="true" />
          <span className="break-words">
            Connected{shown ? ' as ' : ''}
            {shown && <strong className="font-medium">{shown}</strong>}
          </span>
        </p>
        <button
          type="button"
          onClick={onDisconnect}
          aria-label={`Disconnect ${label}`}
          className={SECONDARY_BUTTON}
        >
          Disconnect
        </button>
        <Link href={CONNECTIONS_PATH} className={TEXT_LINK}>
          Manage
        </Link>
      </div>
    );
  }

  const lapsed = connection.status === 'needs_reauth' || connection.status === 'revoked';

  return (
    <>
      <p className="text-on-surface-variant text-sm leading-relaxed">
        {lapsed
          ? `Your ${label} access${connection.accountName ? ` for ${connection.accountName}` : ''} has lapsed. Reconnect to continue - nothing you have planned is affected.`
          : oauth
            ? `Connect your ${label} account so Throughline can ${PROVIDER_PURPOSE[provider].toLowerCase()} for you. Planning never needs it - only this step does.`
            : `Add your ${label} API key so Throughline can ${PROVIDER_PURPOSE[provider].toLowerCase()} for you. Planning never needs it - only this step does.`}
      </p>
      {connectHref ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Plain anchor: this is a server redirect to the provider, not a client route. */}
          <a href={connectHref} className={PRIMARY_LINK}>
            {lapsed ? `Reconnect ${label}` : `Connect ${label}`}
          </a>
          <Link href={CONNECTIONS_PATH} className={TEXT_LINK}>
            Manage
          </Link>
        </div>
      ) : (
        <StitchKeyForm reconnect={lapsed} onSaved={onKeySaved} />
      )}
    </>
  );
}
