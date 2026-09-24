import { NextResponse } from 'next/server';
import { getAppUserById, getVerifiedUser, upsertAppUser } from '@/auth';
import { ApiError, errorResponse } from '@/lib/errors';

// API Contracts section 2: called once by the client right after Supabase
// sign-in. Not project-scoped - the one route exempt from
// `requireProjectOwner` (section 1.1).
export async function POST(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'No verified session.');

    await upsertAppUser(user);
    // Re-read the persisted row rather than assuming displayName - upsertAppUser
    // returns void, and the stored value (e.g. set by a later profile edit) is
    // what the response must reflect, not always null.
    const appUser = await getAppUserById(user.id);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: appUser?.displayName ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
