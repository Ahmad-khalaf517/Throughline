import { inspect } from 'node:util';
import type { ConnectionProvider } from './errors';

// Server-only, non-serializable credential (NFR-005, Module Boundaries 4.9).
// The token lives in a #private field and behind a prototype getter, so it is
// not an own enumerable property: spread, Object.keys, structuredClone and
// util.inspect cannot reach it. JSON.stringify throws instead of leaking, and
// console.log / util.inspect print a redacted marker.
export class Credential {
  readonly connectionId: string;
  readonly provider: ConnectionProvider;
  readonly accountId: string;
  readonly meta: Readonly<Record<string, string>>;
  readonly #accessToken: string;

  constructor(args: {
    connectionId: string;
    provider: ConnectionProvider;
    accountId: string;
    accessToken: string;
    meta: Record<string, string>;
  }) {
    this.connectionId = args.connectionId;
    this.provider = args.provider;
    this.accountId = args.accountId;
    this.meta = Object.freeze({ ...args.meta });
    this.#accessToken = args.accessToken;
  }

  get accessToken(): string {
    return this.#accessToken;
  }

  toJSON(): never {
    throw new Error('A Credential is not serializable.');
  }

  toString(): string {
    return '[Credential redacted]';
  }

  [inspect.custom](): string {
    return `Credential { provider: '${this.provider}', connectionId: '${this.connectionId}', accessToken: [redacted] }`;
  }
}
