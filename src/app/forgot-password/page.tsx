import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getVerifiedUser } from '@/auth';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export default async function ForgotPasswordPage() {
  const user = await getVerifiedUser();
  if (user) redirect('/');

  return (
    <AuthShell>
      {/* useSearchParams (for the ?error=link_failed banner) requires a
          Suspense boundary - Next.js App Router build requirement. */}
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
