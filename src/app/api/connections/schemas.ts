import { z } from 'zod';

// API Contracts 10A. Pulled out of the route handlers, same convention as
// src/app/api/projects/schemas.ts. Both schemas are deliberately lenient about
// content: `returnTo` is validated (and silently dropped when it is not a
// relative path) by `connections.beginOAuth`, and a callback with a missing or
// malformed `code`/`state` is a redirect with `error=invalid_state`, not a 400 -
// the browser is mid-navigation and needs somewhere to land.
export const oauthStartQuerySchema = z.object({
  returnTo: z.string().optional(),
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

// Only these three provider segments exist (API Contracts 10A); anything else is 404.
export const providerParamSchema = z.enum(['github', 'jira', 'stitch']);
