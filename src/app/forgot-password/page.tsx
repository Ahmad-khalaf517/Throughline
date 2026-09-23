import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export default function ForgotPasswordPage() {
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
