import { z } from 'zod';

// API Contracts section 4: `POST /api/projects/:projectId/artifacts/:type/generate`.
// Pulled out of the route handler, same convention as
// src/app/api/projects/schemas.ts. `feedback` is folded into the prompt for an
// AI revision of an existing approved version, omitted for a first generation;
// an empty body is valid too (readOptionalJsonBody turns it into `{}`).
export const generateSchema = z.object({
  feedback: z.string().optional(),
});
