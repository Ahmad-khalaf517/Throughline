import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAppUserById, getVerifiedUser } from '@/auth';
import { UserMenu } from '@/components/projects/user-menu';
import { signOutAction, updateDisplayNameAction } from '../actions';

/**
 * Shell for the Connections screen (FR-087): the same header as `/projects`
 * (brand link + account menu) without the project sidebar - connections belong
 * to the user, not to a project (FR-004 round 14 exception).
 */
export default async function ConnectionsLayout({ children }: LayoutProps<'/connections'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

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
              displayName={appUser?.displayName ?? null}
              email={user.email}
              signOutAction={signOutAction}
              updateDisplayNameAction={updateDisplayNameAction}
            />
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1440px]">{children}</div>
    </div>
  );
}
