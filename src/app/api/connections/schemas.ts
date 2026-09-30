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

// `GET /api/connections/jira/projects` (API Contracts 10A): `cloudId` is required.
export const jiraProjectsQuerySchema = z.object({
  cloudId: z.string().trim().min(1, 'cloudId is required'),
});

// `POST /api/connections/jira/projects` (API Contracts 10A, ERD 7.8): the key is
// uppercase letters and digits, 2-10 characters, starting with a letter.
export const createJiraProjectSchema = z.object({
  cloudId: z.string().trim().min(1, 'cloudId is required'),
  name: z.string().trim().min(1, 'name is required').max(80),
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'key must be 2-10 uppercase letters or digits'),
  template: z.enum(['scrum', 'kanban']),
});

// Only these three provider segments exist (API Contracts 10A); anything else is 404.
export const providerParamSchema = z.enum(['github', 'jira', 'stitch']);

// `POST /api/connections/stitch` (API Contracts 10A): the one request in the API
// that carries a provider secret. Trimmed (a pasted key often has a trailing
// newline); the upper bound only rejects absurd input before it reaches the SDK.
export const stitchConnectSchema = z.object({
  apiKey: z.string().trim().min(1).max(2048),
});
