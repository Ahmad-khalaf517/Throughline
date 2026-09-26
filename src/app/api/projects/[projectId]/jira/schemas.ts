import { z } from 'zod';

// API Contracts section 9. Pulled out of the route handlers, same convention
// as src/app/api/projects/schemas.ts.
export const jiraExportSchema = z.object({
  decisions: z.array(
    z.object({
      logicalItemId: z.string().min(1, 'logicalItemId is required'),
      decision: z.enum(['skip', 'create_new']),
    }),
  ),
  impactAcknowledged: z.boolean(),
});
