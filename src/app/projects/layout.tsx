import { redirect } from 'next/navigation';
import { getAppUserById, getVerifiedUser } from '@/auth';
import { AppHeader } from '@/components/projects/app-header';
import { ProjectSidebar } from '@/components/projects/project-sidebar';
import { signOutAction, updateDisplayNameAction } from '../actions';
import { loadIntegrationsSummary } from '../integrations-summary';

export default async function ProjectsLayout({ children }: LayoutProps<'/projects'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  // getVerifiedUser's displayName reflects Supabase Auth's user_metadata
  // (set at sign-up only), not the app_user row - re-read the persisted row,
  // same as session/bootstrap/route.ts, since that's what stays current.
  const [appUser, integrations] = await Promise.all([
    getAppUserById(user.id),
    loadIntegrationsSummary(user.id),
  ]);

  return (
    <div className="bg-surface text-on-surface min-h-screen">
      <AppHeader
        displayName={appUser?.displayName ?? null}
        email={user.email}
        integrations={integrations}
        signOutAction={signOutAction}
        updateDisplayNameAction={updateDisplayNameAction}
      />
      <div className="mx-auto flex w-full max-w-[1440px]">
        <ProjectSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
