import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  codeOnly,
  declaredFieldNames,
  findConsoleUse,
  findSecretSinks,
  formatFindings,
  isAllowed,
  jsonResponseKeys,
  listSourceFiles,
  rel,
  type AllowEntry,
} from './scan';

// NFR-005 / UC-S8 (extends E6-S3 and T34/T45): static guards that keep a
// credential out of logs, error messages, persisted columns and API bodies.
// They read source text only (no database, no network) and are deliberately
// regex-level - see ./scan.ts. The allowlist file is the escape hatch of last
// resort and is empty on purpose.

const SRC = path.join(REPO_ROOT, 'src');
const allowlist: AllowEntry[] = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'tests/unit/security/no-secrets.allowlist.json'), 'utf8'),
) as AllowEntry[];

const read = (file: string) => fs.readFileSync(file, 'utf8');
const sourceFiles = listSourceFiles(SRC);

describe('scanner self-checks (the guards must be able to fire)', () => {
  it('ignores comments and string content but keeps template expressions', () => {
    const code = codeOnly(
      [
        '// console.log(accessToken)',
        "const a = 'apiKey must be set';",
        'const b = `bad ${refreshToken} here`;',
        '/* new Error(accessToken) */',
        'const re = /[\'"]apiKey/g;',
      ].join('\n'),
    );
    expect(code).not.toMatch(/console/);
    expect(code).not.toMatch(/apiKey/);
    expect(code).toMatch(/refreshToken/);
    expect(code.split('\n')).toHaveLength(5);
  });

  it('flags a credential passed to a log call, an Error message and a persisted column', () => {
    const source = [
      'console.error("failed", credential.accessToken);',
      'throw new Error(`refresh failed for ${refreshToken}`);',
      'await tx.update(t).set({ errorMessage: `x ${apiKey}` });',
      'const row = { targetDescriptor: { token: accessToken }, other: 1 };',
      'const meta = { metadata: input.access_token };',
    ].join('\n');
    const kinds = findSecretSinks('src/x.ts', source).map((f) => f.kind);
    expect(kinds).toEqual([
      'logged',
      'error-message',
      'persisted:errorMessage',
      'persisted:targetDescriptor',
      'persisted:metadata',
    ]);
  });

  it('does not flag fixed messages or identifiers used elsewhere', () => {
    const source = [
      "throw new ApiError('VALIDATION_ERROR', 'apiKey must be a non-empty string.');",
      'const client = new Octokit({ auth: credential.accessToken });',
      'await save({ accessToken: apiKey });',
      'console.error("Unhandled route error:", error);',
    ].join('\n');
    expect(findSecretSinks('src/x.ts', source)).toEqual([]);
  });

  it('flags any console use in code but not in comments', () => {
    expect(
      findConsoleUse('src/connections/x.ts', '// console.log(1)\nconsole.warn("x");'),
    ).toHaveLength(1);
  });
});

describe('no credential in logs, error messages or persisted columns (NFR-005)', () => {
  it('src/connections/** never calls console.*', () => {
    const files = sourceFiles.filter((f) => rel(f).startsWith('src/connections/'));
    expect(files.length).toBeGreaterThan(5);
    const findings = files
      .flatMap((f) => findConsoleUse(rel(f), read(f)))
      .filter((f) => !isAllowed(f, allowlist));
    expect(findings, formatFindings(findings)).toEqual([]);
  });

  it('no credential identifier is passed to console/logger, put in an Error message, or written to target_descriptor / metadata / error_message / provider_meta', () => {
    const findings = sourceFiles
      .flatMap((f) => findSecretSinks(rel(f), read(f)))
      .filter((f) => !isAllowed(f, allowlist));
    expect(findings, formatFindings(findings)).toEqual([]);
  });

  it('every allowlist entry is still needed and justified', () => {
    for (const entry of allowlist) {
      expect(
        entry.reason.trim().length,
        `${entry.file}: allowlist entry needs a reason`,
      ).toBeGreaterThan(10);
      const file = path.join(REPO_ROOT, entry.file);
      expect(
        fs.existsSync(file),
        `${entry.file} no longer exists - remove its allowlist entry`,
      ).toBe(true);
      const stillFlagged = [
        ...findConsoleUse(entry.file, read(file)),
        ...findSecretSinks(entry.file, read(file)),
      ].some((f) => f.snippet.includes(entry.match));
      expect(stillFlagged, `${entry.file}: stale allowlist entry "${entry.match}"`).toBe(true);
    }
  });
});

describe('.env.example matches the env schema (NFR-005)', () => {
  const schemaKeys = [
    ...read(path.join(SRC, 'lib/env.ts')).matchAll(/^ {2}([A-Z][A-Z0-9_]*):\s*z\./gm),
  ].map((m) => m[1]!);
  const example = new Map<string, string>();
  for (const line of read(path.join(REPO_ROOT, '.env.example')).split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) example.set(match[1]!, match[2]!);
  }
  // Non-secret local defaults that are documented with a value.
  const ALLOWED_DEFAULTS: Record<string, string> = {
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  };

  it('finds the schema keys (guards the extraction itself)', () => {
    expect(schemaKeys).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'CONNECTION_ENCRYPTION_KEY']),
    );
    expect(new Set(schemaKeys).size).toBe(schemaKeys.length);
  });

  it('lists every key the schema declares', () => {
    const missing = schemaKeys.filter((key) => !example.has(key));
    expect(missing, `add these to .env.example (empty): ${missing.join(', ')}`).toEqual([]);
  });

  it('lists no key the schema does not declare', () => {
    const extra = [...example.keys()].filter((key) => !schemaKeys.includes(key));
    expect(
      extra,
      `remove from .env.example or declare in src/lib/env.ts: ${extra.join(', ')}`,
    ).toEqual([]);
  });

  it('carries no values, except documented non-secret defaults', () => {
    const withValues = [...example.entries()]
      .filter(([key, value]) => value !== '' && ALLOWED_DEFAULTS[key] !== value)
      .map(([key]) => key);
    expect(withValues, `.env.example must not contain values: ${withValues.join(', ')}`).toEqual(
      [],
    );
  });
});

describe('connection API bodies expose no credential-shaped field (NFR-005)', () => {
  const FORBIDDEN_FIELD = /token|secret|cipher|password|api_?key|(^|_)enc$|[a-z]Enc$/i;

  it('the connection DTO / status types declare no credential-shaped field', () => {
    const serialize = read(path.join(SRC, 'lib/serialize.ts'));
    const store = read(path.join(SRC, 'connections/store.ts'));
    const fields = [
      ...declaredFieldNames(serialize, 'ConnectionDTO'),
      ...declaredFieldNames(serialize, 'ConnectionInput'),
      ...declaredFieldNames(store, 'ConnectionStatus'),
    ];
    expect(fields).toEqual(
      expect.arrayContaining(['provider', 'status', 'displayName', 'scopes', 'connectedAt']),
    );
    expect(fields.filter((name) => FORBIDDEN_FIELD.test(name))).toEqual([]);
  });

  it('no route under src/app/api/connections builds a JSON body with a credential-shaped key', () => {
    const routes = listSourceFiles(path.join(SRC, 'app/api/connections')).filter((f) =>
      f.endsWith('route.ts'),
    );
    expect(routes.length).toBeGreaterThanOrEqual(8);
    const offenders = routes.flatMap((file) =>
      jsonResponseKeys(read(file))
        .filter((key) => FORBIDDEN_FIELD.test(key))
        .map((key) => `${rel(file)}: ${key}`),
    );
    expect(offenders).toEqual([]);
  });

  it('the credential-shaped-field detector fires on what it should', () => {
    const sample = 'export interface D { provider: string; accessToken: string; api_key: string }';
    expect(declaredFieldNames(sample, 'D').filter((n) => FORBIDDEN_FIELD.test(n))).toEqual([
      'accessToken',
      'api_key',
    ]);
    expect(jsonResponseKeys('return NextResponse.json({ ok: true, refreshTokenEnc: x })')).toEqual([
      'ok',
      'refreshTokenEnc',
    ]);
  });
});
