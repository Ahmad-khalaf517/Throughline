import { describe, expect, it } from 'vitest';
import { createProjectSchema, updateProjectSchema } from '@/app/api/projects/schemas';

describe('createProjectSchema (POST /api/projects)', () => {
  it('accepts a minimal valid body', () => {
    const result = createProjectSchema.safeParse({ name: 'My Project', brief: 'Do the thing.' });
    expect(result.success).toBe(true);
  });

  it('accepts an optional inputContext of any shape', () => {
    const result = createProjectSchema.safeParse({
      name: 'My Project',
      brief: 'Do the thing.',
      inputContext: { teamSize: 3, deadline: '2026-01-01' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing name', () => {
    const result = createProjectSchema.safeParse({ brief: 'Do the thing.' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing brief', () => {
    const result = createProjectSchema.safeParse({ name: 'My Project' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string name', () => {
    const result = createProjectSchema.safeParse({ name: '', brief: 'Do the thing.' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string brief', () => {
    const result = createProjectSchema.safeParse({ name: 'My Project', brief: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string name', () => {
    const result = createProjectSchema.safeParse({ name: 42, brief: 'Do the thing.' });
    expect(result.success).toBe(false);
  });
});

describe('updateProjectSchema (PATCH /api/projects/:projectId)', () => {
  it('accepts an empty object (no-op update)', () => {
    const result = updateProjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts name only', () => {
    const result = updateProjectSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts brief and inputContext together', () => {
    const result = updateProjectSchema.safeParse({ brief: 'New brief.', inputContext: null });
    expect(result.success).toBe(true);
  });

  it('rejects an empty-string name when provided', () => {
    const result = updateProjectSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string brief when provided', () => {
    const result = updateProjectSchema.safeParse({ brief: '' });
    expect(result.success).toBe(false);
  });
});
