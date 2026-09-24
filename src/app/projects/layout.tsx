import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/auth';
import { Footer } from '@/components/marketing/footer';
import { Navbar } from '@/components/marketing/navbar';
import { signOutAction } from '../actions';

/**
 * Shared nav/footer + the auth guard for every `/projects` screen (E5-S1
 * review fix). Composes `Navbar`/`Footer` the same way `app/page.tsx` does -
 * `app/layout.tsx` itself renders neither. Pages under here keep their own
 * `getVerifiedUser()` call too (they need `user.id` for their own queries,
 * and a layout can't pass props down to a page); `getVerifiedUser` is
 * `React.cache`-wrapped (`src/auth/index.ts`) so the two calls in one
 * request share a single Supabase round trip.
 */
export default async function ProjectsLayout({ children }: LayoutProps<'/projects'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  return (
    <>
      <Navbar userEmail={user.email} onSignOut={signOutAction} />
      {children}
      <Footer userEmail={user.email} />
    </>
  );
}
