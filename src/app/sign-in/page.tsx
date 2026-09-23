import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getVerifiedUser } from '@/auth';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from './sign-in-form';

export default async function SignInPage() {
  const user = await getVerifiedUser();
  if (user) redirect('/');

  return (
    <AuthShell>
      {/* useSearchParams (for the ?error=verification_failed banner) requires
          a Suspense boundary - Next.js App Router build requirement. */}
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
