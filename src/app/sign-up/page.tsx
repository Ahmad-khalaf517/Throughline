import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/auth';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from './sign-up-form';

export default async function SignUpPage() {
  const user = await getVerifiedUser();
  if (user) redirect('/');

  return (
    <AuthShell>
      <SignUpForm />
    </AuthShell>
  );
}
