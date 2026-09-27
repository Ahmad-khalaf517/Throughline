import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/impact/acknowledgements (API
// Contracts section 6). `@/auth`, `@/artifact-lifecycle` and `@/external/
// operations` are mocked wholesale, so no DB or env is touched; the request
// schema and `_shared/body.ts` are real. `getItemVersionProjectIds` is given a
// small in-memory implementation (an id absent from `projectOfId` is unknown,
// exactly as the real function reports it) so each 404 case is a plain change of
// data rather than a hand-built mock return.
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  acknowledgeImpactWarning: vi.fn(),
  getItemVersionProjectIds: vi.fn(),
}));

vi.mock('@/external/operations', () => ({ getRefById: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { acknowledgeImpactWarning, getItemVersionProjectIds } from '@/artifact-lifecycle';
import { getRefById, type ExternalRef } from '@/external/operations';
import { POST } from '@/app/api/impact/acknowledgements/route';
import { ApiError } from '@/lib/errors';
import { USER, jsonRequest, rawRequest } from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedAcknowledge = vi.mocked(acknowledgeImpactWarning);
const mockedGetProjectIds = vi.mocked(getItemVersionProjectIds);
const mockedGetRefById = vi.mocked(getRefById);

const URL_ACK = 'http://localhost/api/impact/acknowledgements';

// Well-formed uuids: the schema shape-checks every id before anything is looked up.
// They contain hex letters on purpose, so the uppercase-spelling test really differs.
const SUBJECT = 'a1a1a1a1-1111-4111-8111-b1b1b1b1b1b1';
const REF = 'c2c2c2c2-2222-4222-8222-d2d2d2d2d2d2';
const ROOT = 'e3e3e3e3-3333-4333-8333-f3f3f3f3f3f3';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const OTHER_PROJECT = '55555555-5555-4555-8555-555555555555';

// item_version.id -> project_id for every item version that "exists".
let projectOfId: Map<string, string>;

function makeExternalRef(projectId: string): ExternalRef {
  return {
    id: REF,
    projectId,
    provider: 'jira',
    externalId: 'ext-1',
    externalKey: 'THR-1',
    externalUrl: 'https://example.test/browse/THR-1',
    sourceArtifactVersionId: 'backlog-v1',
    sourceItemVersionId: SUBJECT,
    externalOperationId: 'op-1',
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

function post(body?: unknown) {
  return POST(jsonRequest('POST', URL_ACK, body));
}

function expectNothingAcknowledged() {
  expect(mockedAcknowledge).not.toHaveBeenCalled();
}

const itemBody = { subjectItemVersionId: SUBJECT, obsoleteUpstreamItemVersionId: ROOT };
const refBody = { subjectExternalRefId: REF, obsoleteUpstreamItemVersionId: ROOT };

describe('POST /api/impact/acknowledgements', () => {
  beforeEach(() => {
    projectOfId = new Map([
      [SUBJECT, PROJECT],
      [ROOT, PROJECT],
    ]);
    mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetProjectIds.mockReset().mockImplementation(async (ids) => {
      const found = new Map<string, string>();
      for (const id of ids) {
        const projectId = projectOfId.get(id);
        if (projectId) found.set(id, projectId);
      }
      return found;
    });
    mockedGetRefById.mockReset().mockResolvedValue(makeExternalRef(PROJECT));
    mockedAcknowledge.mockReset().mockResolvedValue({ status: 'acknowledged' });
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user, before reading the body', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await post(itemBody);

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetProjectIds).not.toHaveBeenCalled();
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expectNothingAcknowledged();
  });

  describe('success', () => {
    it('returns 201 { acknowledged: true } for a newly written acknowledgement', async () => {
      const response = await post({ ...itemBody, note: 'Reviewed; the story is unaffected.' });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ acknowledged: true });
    });

    it('returns the same 201 { acknowledged: true } when the pair was already acknowledged (idempotent)', async () => {
      mockedAcknowledge.mockResolvedValue({ status: 'already_acknowledged' });

      const response = await post(itemBody);

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ acknowledged: true });
    });

    it('calls acknowledgeImpactWarning with the verified user, the resolved project and the body verbatim', async () => {
      await post({ ...itemBody, note: 'Reviewed; the story is unaffected.' });

      expect(mockedAcknowledge).toHaveBeenCalledTimes(1);
      expect(mockedAcknowledge).toHaveBeenCalledWith({
        projectId: PROJECT,
        userId: 'user-1',
        subject: { itemVersionId: SUBJECT },
        obsoleteUpstreamItemVersionId: ROOT,
        note: 'Reviewed; the story is unaffected.',
      });
    });

    it('checks ownership of the project the ids resolved to, for the verified user', async () => {
      await post(itemBody);

      expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', PROJECT);
    });

    it('resolves an item-version subject and the root together through getItemVersionProjectIds, never getRefById', async () => {
      await post(itemBody);

      expect(mockedGetProjectIds).toHaveBeenCalledWith([SUBJECT, ROOT]);
      expect(mockedGetRefById).not.toHaveBeenCalled();
    });

    it('resolves an external-ref subject through getRefById and the root through getItemVersionProjectIds', async () => {
      const response = await post({ ...refBody, note: 'Ref reviewed.' });

      expect(response.status).toBe(201);
      expect(mockedGetRefById).toHaveBeenCalledWith(REF);
      expect(mockedGetProjectIds).toHaveBeenCalledWith([ROOT]);
      expect(mockedAcknowledge).toHaveBeenCalledWith({
        projectId: PROJECT,
        userId: 'user-1',
        subject: { externalRefId: REF },
        obsoleteUpstreamItemVersionId: ROOT,
        note: 'Ref reviewed.',
      });
    });

    it.each([['  keeps its   spacing\nand newline \t'], ['']])(
      'stores the note exactly as sent, without trimming or dropping it (%j)',
      async (note) => {
        await post({ ...itemBody, note });

        expect(mockedAcknowledge.mock.calls[0]![0].note).toBe(note);
      },
    );

    it('passes an omitted note through as undefined', async () => {
      const response = await post(itemBody);

      expect(response.status).toBe(201);
      expect(mockedAcknowledge.mock.calls[0]![0].note).toBeUndefined();
    });

    it('lowercases uuids, so an uppercase spelling of a real id is not a spurious 404', async () => {
      const response = await post({
        subjectItemVersionId: SUBJECT.toUpperCase(),
        obsoleteUpstreamItemVersionId: ROOT.toUpperCase(),
      });

      expect(response.status).toBe(201);
      expect(mockedGetProjectIds).toHaveBeenCalledWith([SUBJECT, ROOT]);
      expect(mockedAcknowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: { itemVersionId: SUBJECT },
          obsoleteUpstreamItemVersionId: ROOT,
        }),
      );
    });

    it('lowercases the external-ref subject and the root too, so an uppercase ref id still resolves', async () => {
      // The lookups only know the lowercase ids, as Postgres does: an uppercase
      // spelling passed through unchanged would be answered 404.
      mockedGetRefById.mockImplementation(async (id) =>
        id === REF ? makeExternalRef(PROJECT) : null,
      );

      const response = await post({
        subjectExternalRefId: REF.toUpperCase(),
        obsoleteUpstreamItemVersionId: ROOT.toUpperCase(),
        note: 'Ref reviewed.',
      });

      expect(response.status).toBe(201);
      expect(mockedGetRefById).toHaveBeenCalledWith(REF);
      expect(mockedGetProjectIds).toHaveBeenCalledWith([ROOT]);
      expect(mockedAcknowledge).toHaveBeenCalledWith({
        projectId: PROJECT,
        userId: 'user-1',
        subject: { externalRefId: REF },
        obsoleteUpstreamItemVersionId: ROOT,
        note: 'Ref reviewed.',
      });
    });
  });

  describe('request validation (400 VALIDATION_ERROR)', () => {
    async function expectValidationError(response: Response) {
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      // Nothing is looked up, authorized or written for a body that never validated.
      expect(mockedGetProjectIds).not.toHaveBeenCalled();
      expect(mockedGetRefById).not.toHaveBeenCalled();
      expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
      expectNothingAcknowledged();
    }

    it('rejects malformed JSON', async () => {
      await expectValidationError(await POST(rawRequest('POST', URL_ACK, '{not json')));
    });

    it('rejects a missing body (the body is required here)', async () => {
      await expectValidationError(await POST(new Request(URL_ACK, { method: 'POST' })));
    });

    it.each([[null], [[]], ['a string'], [5]])(
      'rejects a body that is not an object (%j)',
      async (body) => {
        await expectValidationError(await post(body));
      },
    );

    it('rejects a body with NO subject field', async () => {
      await expectValidationError(await post({ obsoleteUpstreamItemVersionId: ROOT }));
    });

    it('rejects a body with BOTH subject fields', async () => {
      await expectValidationError(
        await post({
          subjectItemVersionId: SUBJECT,
          subjectExternalRefId: REF,
          obsoleteUpstreamItemVersionId: ROOT,
        }),
      );
    });

    it('explains the exactly-one rule in the error details', async () => {
      const response = await post({ obsoleteUpstreamItemVersionId: ROOT });

      const { error } = await response.json();
      expect(error.details.formErrors).toEqual([
        'Exactly one of subjectItemVersionId and subjectExternalRefId is required.',
      ]);
    });

    it.each([
      ['a non-uuid subjectItemVersionId', { ...itemBody, subjectItemVersionId: 'not-a-uuid' }],
      ['an empty subjectItemVersionId', { ...itemBody, subjectItemVersionId: '' }],
      ['a non-uuid subjectExternalRefId', { ...refBody, subjectExternalRefId: 'ref-1' }],
      [
        'a non-uuid obsoleteUpstreamItemVersionId',
        { ...itemBody, obsoleteUpstreamItemVersionId: 'x' },
      ],
      ['an injection-shaped id', { ...itemBody, subjectItemVersionId: "1' OR '1'='1" }],
      ['a null subject field', { ...itemBody, subjectItemVersionId: null }],
      ['a numeric subject field', { ...itemBody, subjectItemVersionId: 5 }],
    ])('rejects %s', async (_label, body) => {
      await expectValidationError(await post(body));
    });

    it.each([
      ['missing', { subjectItemVersionId: SUBJECT }],
      ['null', { ...itemBody, obsoleteUpstreamItemVersionId: null }],
    ])('rejects an obsoleteUpstreamItemVersionId that is %s', async (_label, body) => {
      await expectValidationError(await post(body));
    });

    it('rejects a note that is not a string', async () => {
      await expectValidationError(await post({ ...itemBody, note: 5 }));
    });

    // Postgres cannot store U+0000 in a text column (22021), so it would be a 500
    // after the project lock was taken - it is a 400 here instead.
    it.each([['\u0000'], ['before\u0000after'], ['trailing\u0000']])(
      'rejects a note containing a NUL character (%j)',
      async (note) => {
        await expectValidationError(await post({ ...itemBody, note }));
        await expectValidationError(await post({ ...refBody, note }));
      },
    );

    it('names the NUL note as the problem in the error details', async () => {
      const response = await post({ ...itemBody, note: 'a\u0000b' });

      const { error } = await response.json();
      expect(error.details.fieldErrors.note).toEqual(['note must not contain a NUL character']);
    });
  });

  describe('404 NOT_FOUND (never 403) - one identical body for every way to miss', () => {
    // Each case leaves the request well-formed and changes only what the ids
    // resolve to (or who owns the project).
    const cases: [string, () => void][] = [
      ['the item-version subject does not exist', () => projectOfId.delete(SUBJECT)],
      ['the obsolete root does not exist', () => projectOfId.delete(ROOT)],
      [
        'the subject and the root are in DIFFERENT projects',
        () => projectOfId.set(ROOT, OTHER_PROJECT),
      ],
      [
        "the project is not the caller's",
        () =>
          mockedRequireProjectOwner.mockRejectedValue(
            new ApiError('NOT_FOUND', 'Project not found.'),
          ),
      ],
    ];

    async function respond(setup: () => void, body: unknown = itemBody) {
      setup();
      const response = await post(body);
      return { status: response.status, text: await response.text() };
    }

    it.each(cases)('is 404 when %s, and nothing is acknowledged', async (_label, setup) => {
      const { status, text } = await respond(setup);

      expect(status).toBe(404);
      expect(JSON.parse(text).error.code).toBe('NOT_FOUND');
      expectNothingAcknowledged();
    });

    it('is 404 when the external-ref subject does not exist', async () => {
      mockedGetRefById.mockResolvedValue(null);

      const response = await post(refBody);

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('NOT_FOUND');
      expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
      expectNothingAcknowledged();
    });

    it('is 404 when the external-ref subject is in a different project than the root', async () => {
      mockedGetRefById.mockResolvedValue(makeExternalRef(OTHER_PROJECT));

      const response = await post(refBody);

      expect(response.status).toBe(404);
      expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
      expectNothingAcknowledged();
    });

    it('is 404 when the external-ref subject exists but the root does not', async () => {
      projectOfId.delete(ROOT);

      const response = await post(refBody);

      expect(response.status).toBe(404);
      expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
      expectNothingAcknowledged();
    });

    it('is 404 for a project the caller does not own on the external-ref path too', async () => {
      mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

      const response = await post(refBody);

      expect(response.status).toBe(404);
      expectNothingAcknowledged();
    });

    it('answers a byte-identical body for every one of those cases (nothing tells the caller which one it hit)', async () => {
      const texts: string[] = [];
      const statuses = new Set<number>();
      const record = async (setup: () => void, body: unknown) => {
        // Fresh world per case, so an earlier case's setup does not leak into the next.
        projectOfId = new Map([
          [SUBJECT, PROJECT],
          [ROOT, PROJECT],
        ]);
        mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
        mockedGetRefById.mockReset().mockResolvedValue(makeExternalRef(PROJECT));
        const { status, text } = await respond(setup, body);
        statuses.add(status);
        texts.push(text);
      };

      for (const [, setup] of cases) await record(setup, itemBody);
      await record(() => mockedGetRefById.mockResolvedValue(null), refBody);
      await record(
        () => mockedGetRefById.mockResolvedValue(makeExternalRef(OTHER_PROJECT)),
        refBody,
      );
      await record(() => projectOfId.delete(ROOT), refBody);
      // A well-formed id that names nothing at all.
      await record(() => undefined, { ...itemBody, subjectItemVersionId: UNKNOWN });
      await record(
        () =>
          mockedRequireProjectOwner.mockRejectedValue(
            new ApiError('NOT_FOUND', 'Project not found.'),
          ),
        refBody,
      );

      expect([...statuses]).toEqual([404]);
      expect(texts).toHaveLength(9);
      expect(new Set(texts).size).toBe(1);
      // ...and it is the route's own message, not requireProjectOwner's.
      expect(JSON.parse(texts[0]!).error.message).not.toMatch(/project/i);
    });

    it('lets a non-404 failure of requireProjectOwner through as a 500, not a 404', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedRequireProjectOwner.mockRejectedValue(new Error('database is down'));

      const response = await post(itemBody);

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      consoleSpy.mockRestore();
    });
  });

  describe('409 NOT_CURRENTLY_FLAGGED', () => {
    it('is returned when the server finds no such warning right now', async () => {
      mockedAcknowledge.mockResolvedValue({ status: 'not_currently_flagged' });

      const response = await post(itemBody);

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_CURRENTLY_FLAGGED');
      expect(body.error).not.toHaveProperty('details');
    });

    it('words it conservatively: the warning is not flagged any more, never that the item is wrong (INV-024)', async () => {
      mockedAcknowledge.mockResolvedValue({ status: 'not_currently_flagged' });

      const response = await post(refBody);

      expect(response.status).toBe(409);
      expect((await response.json()).error.message).toBe(
        'This warning is no longer flagged for that source change.',
      );
    });

    it('is only reached after ownership is proven (a stranger gets the 404, never this 409)', async () => {
      mockedAcknowledge.mockResolvedValue({ status: 'not_currently_flagged' });
      mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

      const response = await post(itemBody);

      expect(response.status).toBe(404);
      expectNothingAcknowledged();
    });
  });

  it('lets an unrecognized failure from acknowledgeImpactWarning fall through to the generic 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedAcknowledge.mockRejectedValue(new Error('boom'));

    const response = await post(itemBody);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleSpy.mockRestore();
  });
});
