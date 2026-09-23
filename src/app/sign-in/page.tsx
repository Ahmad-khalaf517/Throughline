import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from './sign-in-form';

export default function SignInPage() {
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
