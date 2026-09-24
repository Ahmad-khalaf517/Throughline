import { NextResponse } from 'next/server';
import { getAppUserById, getVerifiedUser, upsertAppUser } from '@/auth';

// API Contracts section 2: called once by the client right after Supabase
// sign-in. Not project-scoped - the one route exempt from
// `requireProjectOwner` (section 1.1).
export async function POST(request: Request) {
  const user = await getVerifiedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'No verified session.' } },
      { status: 401 },
    );
  }

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
}
