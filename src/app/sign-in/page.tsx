import { Suspense } from 'react';
import { SignInForm } from './sign-in-form';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      {/* useSearchParams (for the ?error=verification_failed banner) requires
          a Suspense boundary - Next.js App Router build requirement. */}
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
