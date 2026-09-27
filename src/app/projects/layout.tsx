import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAppUserById, getVerifiedUser } from '@/auth';
import { ProjectSidebar } from '@/components/projects/project-sidebar';
import { UserMenu } from '@/components/projects/user-menu';
import { signOutAction } from '../actions';

export default async function ProjectsLayout({ children }: LayoutProps<'/projects'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  // getVerifiedUser's displayName reflects Supabase Auth's user_metadata
  // (set at sign-up only), not the app_user row - re-read the persisted row,
  // same as session/bootstrap/route.ts, since that's what stays current.
  const appUser = await getAppUserById(user.id);

  return (
    <div className="bg-surface text-on-surface min-h-screen">
      <header className="border-surface-dim bg-surface-container-lowest sticky top-0 z-40 border-b">
        <div className="mx-auto flex min-h-10 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/projects"
            className="text-on-surface focus-visible:ring-primary rounded-md text-xs font-semibold tracking-tight focus-visible:ring-2 focus-visible:outline-none"
          >
            THROUGHLINE
          </Link>
          <div className="flex items-center gap-4">
            <UserMenu
              name={appUser?.displayName ?? user.email}
              email={user.email}
              signOutAction={signOutAction}
            />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1440px]">
        <ProjectSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
