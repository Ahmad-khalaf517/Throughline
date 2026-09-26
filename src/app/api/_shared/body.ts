// Shared request-body readers for the artifact/version routes (E3-S10; API
// Contracts sections 4-5). A Next.js "private folder" file, same idea as
// `_shared/external.ts`: no URL of its own, still bound by the layer6 import
// allow-list, and no domain logic - it only turns a `Request` into a value for
// a route's own zod schema to validate.
//
// The older routes copy a `readJsonBody` inline because each has one required
// body. These routes are different: most of them take a body whose every field
// is optional (`{ feedback?: string }`, the approve request), where "no body at
// all" is as valid as `{}` - which `Request.json()` alone cannot express, since
// it throws on an empty body just like on malformed JSON.
import { ApiError } from '@/lib/errors';

/** For a route whose body is required: an empty or malformed body is a 400. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

/**
 * For a route whose body is all-optional: an absent/empty (or whitespace-only)
 * body is `{}`, exactly as if the client had sent `{}`. Malformed JSON is still
 * a 400, and so is any non-empty body that parses to something other than what
 * the route's schema accepts - that check is the caller's zod schema's job, not
 * this function's.
 */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}
