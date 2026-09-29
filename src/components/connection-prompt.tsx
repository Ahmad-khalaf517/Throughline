import { PlugZap } from 'lucide-react';
import {
  CONNECTIONS_PATH,
  connectStartHref,
  describeConnectionPrompt,
  type ConnectionProvider,
  type PreviewConnection,
} from '@/lib/connections-ui';

interface ConnectionPromptProps {
  provider: ConnectionProvider;
  connection: PreviewConnection | null | undefined;
  /** Relative path of the screen the user is on; they are returned here after connecting. */
  returnTo: string;
}

const LINK_CLASSNAME =
  'text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded text-sm font-medium focus-visible:ring-2 focus-visible:outline-none';

/**
 * FR-089 connect-to-continue prompt, shown in place of a write action. The
 * preview content stays visible; the caller keeps its write button disabled
 * while `describeConnectionPrompt` says so. Styled like the neutral
 * "prerequisite not met" card - a to-do, not an error and not a lineage warning.
 * GitHub and Jira start the OAuth flow directly; Stitch (an API key) goes to the
 * Connections screen where the key is entered.
 */
export function ConnectionPrompt({ provider, connection, returnTo }: ConnectionPromptProps) {
  const prompt = describeConnectionPrompt(provider, connection);
  if (!prompt) return null;

  const href = provider === 'stitch' ? CONNECTIONS_PATH : connectStartHref(provider, returnTo);

  return (
    <div
      role="status"
      className="border-status-draft-border bg-status-draft-bg flex flex-col items-start gap-2 rounded-xl border border-dashed p-4"
    >
      <p className="text-on-surface flex items-start gap-2 text-sm font-medium">
        <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{prompt.message}</span>
      </p>
      {prompt.actionLabel && (
        // Plain anchor: the GitHub/Jira link is a server redirect to the
        // provider (not a client route), and the Stitch one is a full page load
        // of the Connections screen.
        <a href={href} className={LINK_CLASSNAME}>
          {prompt.actionLabel} →
        </a>
      )}
    </div>
  );
}
