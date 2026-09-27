import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/auth';
import { ProjectSidebar } from '@/components/projects/project-sidebar';
import { signOutAction } from '../actions';

export default async function ProjectsLayout({ children }: LayoutProps<'/projects'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

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
            <span className="text-on-surface-variant hidden max-w-48 truncate text-xs sm:block">
              {user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-md px-2 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                Sign out
              </button>
            </form>
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
