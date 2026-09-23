'use server';

import { redirect } from 'next/navigation';
import { getVerifiedUser, signInWithEmail, upsertAppUser } from '@/auth';

export type SignInState = { status: 'idle' | 'error'; message: string | null };

export async function signInAction(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { status: 'error', message: 'Email and password are required.' };
  }

  const { error } = await signInWithEmail({ email, password });
  if (error) {
    // Supabase returns the same generic message for "wrong password" and
    // "email not verified yet" - deliberately not distinguished here so a
    // failed guess can't be used to enumerate which emails have signed up.
    return { status: 'error', message: error };
  }

  const user = await getVerifiedUser();
  if (user) {
    await upsertAppUser(user);
  }

  redirect('/');
}
