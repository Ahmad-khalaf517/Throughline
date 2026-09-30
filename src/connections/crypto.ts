import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConnectionConfigError } from './errors';

// AES-256-GCM with a fresh 96-bit IV per write and AAD `<user_id>:<provider>`
// (ERD 4.17, Module Boundaries 4.9 rule 1). Pure functions: the key is passed
// in, so nothing here reads env and the unit tests need no configuration.
// Stored form: `v<key_version>:<iv>:<tag>:<ct>`, each part base64url - this is
// the exact shape provider_connection's token_shape CHECK enforces.

export const CURRENT_KEY_VERSION = 1;

const IV_BYTES = 12;
const KEY_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes CONNECTION_ENCRYPTION_KEY (base64 of exactly 32 bytes). Throws at call time, never echoes the value. */
export function parseKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new ConnectionConfigError('CONNECTION_ENCRYPTION_KEY is not set.');
  }
  const decoded = BASE64.test(raw) ? Buffer.from(raw, 'base64') : null;
  if (!decoded || decoded.length !== KEY_BYTES) {
    throw new ConnectionConfigError(
      'CONNECTION_ENCRYPTION_KEY must be the base64 encoding of exactly 32 bytes.',
    );
  }
  return decoded;
}

function aad(userId: string, provider: string): Buffer {
  return Buffer.from(`${userId}:${provider}`, 'utf8');
}

export function encryptSecret(args: {
  plaintext: string;
  userId: string;
  provider: string;
  key: Buffer;
  keyVersion?: number;
}): string {
  if (args.plaintext.length === 0) {
    throw new ConnectionConfigError('Refusing to encrypt an empty secret.');
  }
  const keyVersion = args.keyVersion ?? CURRENT_KEY_VERSION;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', args.key, iv);
  cipher.setAAD(aad(args.userId, args.provider));
  const ct = Buffer.concat([cipher.update(args.plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyVersion}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

/** Throws on any tampering, wrong key, or wrong AAD (another user's / provider's row). */
export function decryptSecret(args: {
  stored: string;
  userId: string;
  provider: string;
  key: Buffer;
}): string {
  const parts = args.stored.split(':');
  const [version, ivB64, tagB64, ctB64] = parts;
  if (parts.length !== 4 || !version || !/^v[0-9]+$/.test(version) || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed ciphertext.');
  }
  if (Number(version.slice(1)) !== CURRENT_KEY_VERSION) {
    // Key rotation is not implemented: only the current generation is readable.
    throw new ConnectionConfigError('Ciphertext was written with an unavailable key version.');
  }
  const decipher = createDecipheriv('aes-256-gcm', args.key, Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(aad(args.userId, args.provider));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
