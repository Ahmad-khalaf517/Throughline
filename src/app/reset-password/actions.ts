'use server';

import { redirect } from 'next/navigation';
import { updatePassword } from '@/auth';

export type ResetPasswordState = { status: 'idle' | 'error'; message: string | null };

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (!password || !confirmPassword) {
    return { status: 'error', message: 'Both fields are required.' };
  }
  if (password.length < 8) {
    return { status: 'error', message: 'Password must be at least 8 characters.' };
  }
  if (password !== confirmPassword) {
    return { status: 'error', message: 'Passwords do not match.' };
  }

  const { error } = await updatePassword(password);
  if (error) {
    // Most commonly: no valid recovery session (expired/already-used link,
    // or this page was reached directly) - Supabase's own message names
    // this clearly enough to show as-is.
    return { status: 'error', message: error };
  }

  redirect('/');
}
