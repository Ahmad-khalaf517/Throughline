'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { signOut, updateDisplayName } from '@/auth';

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/sign-in');
}

export type UpdateDisplayNameState = {
  status: 'idle' | 'error' | 'success';
  message: string | null;
};

export async function updateDisplayNameAction(
  _prevState: UpdateDisplayNameState,
  formData: FormData,
): Promise<UpdateDisplayNameState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { status: 'error', message: 'Name cannot be empty.' };
  }

  const { error } = await updateDisplayName(name);
  if (error) {
    return { status: 'error', message: error };
  }

  // The dashboard shell (projects/layout.tsx) re-reads the app_user row on
  // every request but Next.js still needs telling to skip its layout cache.
  revalidatePath('/projects', 'layout');
  return { status: 'success', message: null };
}
