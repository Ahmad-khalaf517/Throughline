import { z } from 'zod';

// API Contracts section 6 (`POST /api/impact/acknowledgements`). Pulled out of
// the route handler, same convention as src/app/api/artifact-versions/schemas.ts.
//
// Every id is a uuid: a malformed one is `400 VALIDATION_ERROR` here, so it never
// reaches a lookup; a well-formed one that names nothing (or nothing the caller
// owns) is the route's `404`. Ids are lowercased on the way through - Postgres
// returns uuids in lowercase, and the route matches them against maps and warning
// rows it gets back from there, so an uppercase spelling of a real id must not
// become a spurious 404.
const uuidField = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

// `note` is stored exactly as sent: no trim, no length limit. The contract has
// none, and (unlike the approval override's `overrideNote`) an empty note is
// legal here - it is optional and its DB column is nullable free text. The one
// thing refused is a NUL character (U+0000): JSON can carry it, but Postgres
// cannot store it in a text column (22021 "invalid byte sequence for encoding
// UTF8: 0x00"), which would otherwise surface as a 500 after the lock is taken.
const noteField = z
  .string()
  .refine((note) => !note.includes('\u0000'), 'note must not contain a NUL character');

// "Exactly one of `subjectItemVersionId` / `subjectExternalRefId`" is checked in
// the transform, which also produces the shape `acknowledgeImpactWarning` takes
// (`subject: { itemVersionId } | { externalRefId }`): zero and both are the same
// `400`, and no unreachable branch is left over for the route to write.
export const acknowledgeSchema = z
  .object({
    subjectItemVersionId: uuidField.optional(),
    subjectExternalRefId: uuidField.optional(),
    obsoleteUpstreamItemVersionId: uuidField,
    note: noteField.optional(),
  })
  .transform((body, ctx) => {
    const { subjectItemVersionId, subjectExternalRefId, obsoleteUpstreamItemVersionId, note } =
      body;
    if (subjectItemVersionId !== undefined && subjectExternalRefId === undefined) {
      return {
        subject: { itemVersionId: subjectItemVersionId },
        obsoleteUpstreamItemVersionId,
        note,
      };
    }
    if (subjectExternalRefId !== undefined && subjectItemVersionId === undefined) {
      return {
        subject: { externalRefId: subjectExternalRefId },
        obsoleteUpstreamItemVersionId,
        note,
      };
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exactly one of subjectItemVersionId and subjectExternalRefId is required.',
    });
    return z.NEVER;
  });
