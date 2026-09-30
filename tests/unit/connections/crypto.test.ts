import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, parseKey } from '@/connections/crypto';
import { ConnectionConfigError } from '@/connections/errors';

// The exact shape provider_connection's token_shape CHECK enforces (ERD 4.17).
const DB_SHAPE = /^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

const key = randomBytes(32);
const userId = '11111111-1111-1111-1111-111111111111';
const otherUserId = '22222222-2222-2222-2222-222222222222';
const SENTINEL = 'ghp_SENTINELTOKEN0123456789';

describe('connections crypto (T45 application half, NFR-005)', () => {
  it('round-trips a secret', () => {
    const stored = encryptSecret({ plaintext: SENTINEL, userId, provider: 'github', key });
    expect(decryptSecret({ stored, userId, provider: 'github', key })).toBe(SENTINEL);
  });

  it('produces a string matching the DB CHECK regex, with no plaintext in it', () => {
    const stored = encryptSecret({ plaintext: SENTINEL, userId, provider: 'github', key });
    expect(stored).toMatch(DB_SHAPE);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(SENTINEL);
    expect(stored.split(':')[1]).toHaveLength(16); // 12-byte IV, base64url
  });

  it('uses a fresh IV per write', () => {
    const a = encryptSecret({ plaintext: SENTINEL, userId, provider: 'github', key });
    const b = encryptSecret({ plaintext: SENTINEL, userId, provider: 'github', key });
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });

  function flip(part: string): string {
    const buf = Buffer.from(part, 'base64url');
    buf[0] = buf[0]! ^ 0xff;
    return buf.toString('base64url');
  }

  it('detects a tampered tag', () => {
    const [v, iv, tag, ct] = encryptSecret({
      plaintext: SENTINEL,
      userId,
      provider: 'github',
      key,
    }).split(':');
    expect(() =>
      decryptSecret({ stored: [v, iv, flip(tag!), ct].join(':'), userId, provider: 'github', key }),
    ).toThrow();
  });

  it('detects tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptSecret({
      plaintext: SENTINEL,
      userId,
      provider: 'github',
      key,
    }).split(':');
    expect(() =>
      decryptSecret({ stored: [v, iv, tag, flip(ct!)].join(':'), userId, provider: 'github', key }),
    ).toThrow();
  });

  it('fails under another user id (AAD) and another provider', () => {
    const stored = encryptSecret({ plaintext: SENTINEL, userId, provider: 'github', key });
    expect(() => decryptSecret({ stored, userId: otherUserId, provider: 'github', key })).toThrow();
    expect(() => decryptSecret({ stored, userId, provider: 'jira', key })).toThrow();
  });

  it('fails under a different key', () => {
    const stored = encryptSecret({ plaintext: SENTINEL, userId, provider: 'github', key });
    expect(() =>
      decryptSecret({ stored, userId, provider: 'github', key: randomBytes(32) }),
    ).toThrow();
  });

  it('rejects malformed ciphertext and the tombstone', () => {
    expect(() => decryptSecret({ stored: 'revoked', userId, provider: 'github', key })).toThrow();
    expect(() => decryptSecret({ stored: 'v1:a:b', userId, provider: 'github', key })).toThrow();
  });

  it('refuses to encrypt an empty secret', () => {
    expect(() => encryptSecret({ plaintext: '', userId, provider: 'github', key })).toThrow();
  });
});

describe('parseKey', () => {
  it('accepts exactly 32 base64 bytes', () => {
    expect(parseKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['not base64', 'this is not base64!!'],
  ])('throws a config error for %s, without echoing the value', (_label, raw) => {
    let caught: unknown;
    try {
      parseKey(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConnectionConfigError);
    if (raw) expect((caught as Error).message).not.toContain(raw);
  });
});
