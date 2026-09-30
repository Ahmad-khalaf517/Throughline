import Link from 'next/link';
import { LogoMark } from '@/components/icons/logo-mark';
import type { IntegrationsSummary } from '@/lib/connections-ui';
import { IntegrationsNavLink } from './integrations-nav-link';
import { ProjectsNavLink } from './projects-nav-link';
import { UserMenu } from './user-menu';
import type { UpdateDisplayNameState } from './edit-profile-dialog';

interface AppHeaderProps {
  displayName: string | null;
  email: string;
  /** Status counts for the Integrations link hint; `null` when they could not be read. */
  integrations: IntegrationsSummary | null;
  signOutAction: () => Promise<void>;
  updateDisplayNameAction: (
    prevState: UpdateDisplayNameState,
    formData: FormData,
  ) => Promise<UpdateDisplayNameState>;
}

/**
 * The one persistent header shared by `/projects` (and every project screen
 * under it) and `/connections`: brand link, the top-level Integrations link, and
 * the account menu. Server actions are passed in from the layouts because
 * `components` may not import from `app`.
 */
export function AppHeader({
  displayName,
  email,
  integrations,
  signOutAction,
  updateDisplayNameAction,
}: AppHeaderProps) {
  return (
    <header className="border-surface-dim bg-surface-container-lowest sticky top-0 z-40 border-b">
      <div className="flex min-h-16 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/projects"
          className="text-on-surface focus-visible:ring-primary flex items-center gap-4 rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <LogoMark className="h-5 sm:h-6" />
          <span className="border-surface-dim text-on-surface-variant hidden border-l pl-4 text-xs font-medium sm:inline">
            Workspace
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <ProjectsNavLink />
          <IntegrationsNavLink summary={integrations} />
          <UserMenu
            displayName={displayName}
            email={email}
            signOutAction={signOutAction}
            updateDisplayNameAction={updateDisplayNameAction}
          />
        </div>
      </div>
    </header>
  );
}
