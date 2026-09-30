import { z } from 'zod';

// API Contracts section 8. Pulled out of the route handlers, same convention
// as src/app/api/projects/schemas.ts.
export const githubPreviewSchema = z.object({
  repoName: z.string().min(1, 'repoName is required'),
});

export const githubCheckNameSchema = z.object({
  repoName: z.string().min(1, 'repoName is required'),
});

export const githubInitSchema = z.object({
  repoName: z.string().min(1, 'repoName is required'),
  impactAcknowledged: z.boolean(),
  // Who can read the new repository. Absent = public, what every earlier client sent.
  visibility: z.enum(['public', 'private']).default('public'),
});
