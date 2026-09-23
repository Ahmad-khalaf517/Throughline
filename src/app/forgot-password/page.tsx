import { Suspense } from 'react';
import { ForgotPasswordForm } from './forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      {/* useSearchParams (for the ?error=link_failed banner) requires a
          Suspense boundary - Next.js App Router build requirement. */}
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
