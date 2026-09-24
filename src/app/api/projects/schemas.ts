import { z } from 'zod';

// API Contracts section 3. Pulled out of the route handlers so the
// validation rules are unit-testable without a request/response round trip
// (tests/unit/api/projects-schemas.test.ts) - no domain logic here, just the
// wire-level shape (Project Setup section 3 rule 3 applies to `app/api` the
// same way it applies to `lib`).
export const createProjectSchema = z.object({
  name: z.string().min(1, 'name is required'),
  brief: z.string().min(1, 'brief is required'),
  inputContext: z.unknown().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, 'name must not be empty').optional(),
  brief: z.string().min(1, 'brief must not be empty').optional(),
  inputContext: z.unknown().optional(),
});
