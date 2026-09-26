import { z } from 'zod';

// API Contracts section 10. Pulled out of the route handlers, same
// convention as src/app/api/projects/schemas.ts.
export const stitchGenerateSchema = z.object({
  impactAcknowledged: z.boolean(),
});
