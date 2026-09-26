import { z } from 'zod';

// API Contracts sections 4-5 (the `/api/artifact-versions/:versionId/*` routes).
// Pulled out of the route handlers, same convention as
// src/app/api/projects/schemas.ts. Wire-level shape only: whether a body is
// legal for THIS version (an Architecture approval needs
// `selectedArchitectureOptionId`, every other type must not send one) depends
// on the version's artifact type, so that cross-check stays in the approve
// route next to the lookup that provides it.

// `request-revision` and `reject` (API Contracts 4): `{ feedback?: string }`.
// An empty body is valid too (readOptionalJsonBody turns it into `{}`).
export const feedbackSchema = z.object({
  feedback: z.string().optional(),
});

// `approve` (API Contracts 4). `overrideNote` "present but blank" is a 400
// (the DB CHECK on approval_event is only the backstop for a blank one);
// whitespace-only counts as blank. Not trimmed on the way through: the note is
// stored exactly as the reviewer wrote it.
export const approveSchema = z.object({
  selectedArchitectureOptionId: z
    .string()
    .min(1, 'selectedArchitectureOptionId must not be empty')
    .optional(),
  overrideNote: z
    .string()
    .refine((note) => note.trim().length > 0, 'overrideNote must not be blank')
    .optional(),
});

// `payload` is `unknown` in the contract, but an item's payload is always a
// JSON object (ERD 5.4's per-type field lists); a scalar, array or null could
// never be one. Deliberately NOT per-artifact-type item schemas: which fields
// an item must carry is the artifact-type modules' and identity's business,
// outside API Contracts 5.
const payloadSchema = z.record(z.unknown());

export const itemEditPreviewSchema = z.object({
  payload: payloadSchema,
});

export const itemEditCommitSchema = z.object({
  payload: payloadSchema,
  confirmed: z.boolean(),
});
