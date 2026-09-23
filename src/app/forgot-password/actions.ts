'use server';

import { requestPasswordReset } from '@/auth';

export type ForgotPasswordState = { status: 'idle' | 'error' | 'success'; message: string | null };

export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim();

  if (!email) {
    return { status: 'error', message: 'Email is required.' };
  }

  const { error } = await requestPasswordReset(email);
  if (error) {
    return { status: 'error', message: error };
  }

  return {
    status: 'success',
    message: `If an account exists for ${email}, we sent a link to reset the password.`,
  };
}
