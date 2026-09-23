'use server';

import { signUpWithEmail } from '@/auth';

export type SignUpState = { status: 'idle' | 'error' | 'success'; message: string | null };

export async function signUpAction(
  _prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { status: 'error', message: 'Email and password are required.' };
  }
  if (password.length < 8) {
    return { status: 'error', message: 'Password must be at least 8 characters.' };
  }

  const { error } = await signUpWithEmail({ email, password });
  if (error) {
    return { status: 'error', message: error };
  }

  return {
    status: 'success',
    message: `We sent a verification link to ${email}. Click it to finish creating your account.`,
  };
}
