import { z } from 'zod';

// API Contracts section 8. Pulled out of the route handlers, same convention
// as src/app/api/projects/schemas.ts.
export const githubPreviewSchema = z.object({
  repoName: z.string().min(1, 'repoName is required'),
});

export const githubInitSchema = z.object({
  repoName: z.string().min(1, 'repoName is required'),
  impactAcknowledged: z.boolean(),
});
