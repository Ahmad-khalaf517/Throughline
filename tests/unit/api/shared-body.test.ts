import { describe, expect, it } from 'vitest';
import { readJsonBody, readOptionalJsonBody } from '@/app/api/_shared/body';
import { ApiError } from '@/lib/errors';

// src/app/api/_shared/body.ts (E3-S10): the two request-body readers the
// artifact/version routes share. Pure - a `Request` in, a value or an
// `ApiError('VALIDATION_ERROR')` out - so nothing is mocked.
function post(body?: string): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    ...(body === undefined ? {} : { body }),
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('readOptionalJsonBody', () => {
  it.each([
    ['no body at all', undefined],
    ['an empty body', ''],
    ['a whitespace-only body', '  \n\t '],
  ])('treats %s as {}', async (_label, body) => {
    expect(await readOptionalJsonBody(post(body))).toEqual({});
  });

  it('returns whatever valid JSON was sent, leaving shape validation to the route schema', async () => {
    expect(await readOptionalJsonBody(post('{"feedback":"x"}'))).toEqual({ feedback: 'x' });
    expect(await readOptionalJsonBody(post('[]'))).toEqual([]);
    expect(await readOptionalJsonBody(post('null'))).toBeNull();
    expect(await readOptionalJsonBody(post('7'))).toBe(7);
  });

  it.each(['{oops', '{"a":', 'not json', '{"a":1}}'])(
    'rejects malformed JSON %j with 400 VALIDATION_ERROR',
    async (body) => {
      const error = await rejectionOf(readOptionalJsonBody(post(body)));

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    },
  );
});

describe('readJsonBody', () => {
  it('returns the parsed JSON', async () => {
    expect(await readJsonBody(post('{"payload":{"a":1}}'))).toEqual({ payload: { a: 1 } });
  });

  it.each([
    ['no body at all', undefined],
    ['an empty body', ''],
    ['malformed JSON', '{oops'],
  ])(
    'rejects %s with 400 VALIDATION_ERROR (a required body is not optional)',
    async (_label, body) => {
      const error = await rejectionOf(readJsonBody(post(body)));

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    },
  );
});
