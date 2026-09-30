import { redirect } from 'next/navigation';
import { getAppUserById, getVerifiedUser } from '@/auth';
import { AppHeader } from '@/components/projects/app-header';
import { signOutAction, updateDisplayNameAction } from '../actions';
import { loadIntegrationsSummary } from '../integrations-summary';

/**
 * Shell for the Integrations screen (FR-087; the route stays `/connections` so
 * OAuth redirects keep working): the same header as `/projects` (brand link,
 * Integrations link, account menu) without the project sidebar - integrations
 * belong to the user, not to a project (FR-004 round 14 exception).
 */
export default async function ConnectionsLayout({ children }: LayoutProps<'/connections'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const [appUser, integrations] = await Promise.all([
    getAppUserById(user.id),
    loadIntegrationsSummary(user.id),
  ]);

  return (
    <div className="app-shell bg-surface text-on-surface min-h-screen">
      <AppHeader
        displayName={appUser?.displayName ?? null}
        email={user.email}
        integrations={integrations}
        signOutAction={signOutAction}
        updateDisplayNameAction={updateDisplayNameAction}
      />
      <div className="w-full">{children}</div>
    </div>
  );
}
