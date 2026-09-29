import fs from 'node:fs';
import path from 'node:path';

// A small, dependency-free static scanner behind tests/unit/security/no-secrets.test.ts
// (NFR-005, UC-S8). It works on "code only" text: comments removed and the
// CONTENT of string literals blanked (template `${...}` expressions are kept), so
// a message that merely says "apiKey must be a non-empty string." is not a
// finding while `${apiKey}` inside a template is. Newlines are preserved, so
// offsets map to real line numbers. It is a regex-level guard, not a data-flow
// analysis: it catches the direct mistake (a credential identifier written
// straight into a log call, an Error message or a persisted column), which is the
// mistake that actually happens.

export const REPO_ROOT = process.cwd();

/** Identifiers that carry a credential. Matching is on whole identifiers in code positions. */
export const SECRET_IDENTIFIER =
  /\b(accessToken|refreshToken|apiKey|access_token|refresh_token|clientSecret|client_secret|accessTokenEnc|refreshTokenEnc|plaintext|GITHUB_TOKEN|JIRA_API_TOKEN|STITCH_API_KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|CONNECTION_ENCRYPTION_KEY|OAUTH_STATE_SECRET|GITHUB_MARKER_SECRET|GITHUB_OAUTH_CLIENT_SECRET|ATLASSIAN_CLIENT_SECRET)\b/;

const REGEX_MAY_START_AFTER = /[(,=:[!&|?{};+\-*%<>~^]/;

/** Removes comments and blanks string/regex literal content; keeps template `${}` code. */
export function codeOnly(source: string): string {
  let i = 0;
  const n = source.length;
  let out = '';
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ');

  function lastSignificant(): string {
    const trimmed = out.trimEnd();
    return trimmed.slice(-1);
  }

  function readQuoted(quote: string): void {
    out += quote;
    i += 1;
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (source[i] === '\n') break; // unterminated: do not swallow the file
      out += blank(source[i]!);
      i += 1;
    }
    out += quote;
    i += 1;
  }

  function readRegex(): void {
    out += '/';
    i += 1;
    let inClass = false;
    while (i < n && source[i] !== '\n') {
      const ch = source[i]!;
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      out += ' ';
      i += 1;
    }
    out += '/';
    i += 1;
  }

  function readTemplate(): void {
    out += '`';
    i += 1;
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (source[i] === '$' && source[i + 1] === '{') {
        out += '${';
        i += 2;
        scanCode(true);
        continue;
      }
      out += blank(source[i]!);
      i += 1;
    }
    out += '`';
    i += 1;
  }

  function scanCode(untilCloseBrace: boolean): void {
    let depth = 0;
    while (i < n) {
      const ch = source[i]!;
      const next = source[i + 1];
      if (ch === '/' && next === '/') {
        while (i < n && source[i] !== '\n') {
          out += ' ';
          i += 1;
        }
        continue;
      }
      if (ch === '/' && next === '*') {
        out += '  ';
        i += 2;
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
          out += blank(source[i]!);
          i += 1;
        }
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        readQuoted(ch);
        continue;
      }
      if (ch === '`') {
        readTemplate();
        continue;
      }
      if (ch === '/') {
        const prev = lastSignificant();
        const afterKeyword = /\b(return|typeof|case)\s*$/.test(out);
        if (prev === '' || REGEX_MAY_START_AFTER.test(prev) || afterKeyword) {
          readRegex();
          continue;
        }
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        if (untilCloseBrace && depth === 0) {
          out += '}';
          i += 1;
          return;
        }
        depth -= 1;
      }
      out += ch;
      i += 1;
    }
  }

  scanCode(false);
  return out;
}

function lineOf(code: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index; k += 1) if (code[k] === '\n') line += 1;
  return line;
}

/** Text between the parenthesis at `open` and its match (exclusive). */
function balancedParens(code: string, open: number): string {
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    const ch = code[k];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, k);
    }
  }
  return code.slice(open + 1);
}

/** The expression that follows a `key:` up to the delimiter that ends it at depth 0. */
function propertyExpression(code: string, start: number): string {
  let depth = 0;
  for (let k = start; k < code.length; k += 1) {
    const ch = code[k]!;
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (depth === 0) return code.slice(start, k);
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return code.slice(start, k);
  }
  return code.slice(start);
}

export type Finding = { file: string; line: number; kind: string; snippet: string };

const compact = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Any `console.*` reference in code (src/connections must never log at all). */
export function findConsoleUse(file: string, source: string): Finding[] {
  const code = codeOnly(source);
  const found: Finding[] = [];
  for (const match of code.matchAll(/\bconsole\b/g)) {
    found.push({
      file,
      line: lineOf(code, match.index),
      kind: 'console-in-connections',
      snippet: compact(code.slice(match.index, match.index + 80)),
    });
  }
  return found;
}

/**
 * A credential identifier that reaches (1) a console/logger call, (2) the
 * arguments of an `Error`-family constructor (its message), or (3) a value
 * written to `target_descriptor` / `metadata` / `error_message` / `provider_meta`.
 */
export function findSecretSinks(file: string, source: string): Finding[] {
  const code = codeOnly(source);
  const found: Finding[] = [];
  const report = (kind: string, index: number, text: string) => {
    if (SECRET_IDENTIFIER.test(text)) {
      found.push({ file, line: lineOf(code, index), kind, snippet: compact(text) });
    }
  };

  for (const match of code.matchAll(/\b(?:console|logger|log)\s*\.\s*\w+\s*\(/g)) {
    report('logged', match.index, balancedParens(code, match.index + match[0].length - 1));
  }
  for (const match of code.matchAll(/\bnew\s+\w*Error\s*\(/g)) {
    report('error-message', match.index, balancedParens(code, match.index + match[0].length - 1));
  }
  for (const match of code.matchAll(
    /\b(targetDescriptor|target_descriptor|metadata|errorMessage|error_message|providerMeta|provider_meta)\s*:/g,
  )) {
    const start = match.index + match[0].length;
    report(`persisted:${match[1]}`, match.index, propertyExpression(code, start));
  }
  return found;
}

export function listSourceFiles(dir: string, extensions = ['.ts']): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full);
      } else if (
        extensions.some((ext) => entry.name.endsWith(ext)) &&
        !entry.name.endsWith('.d.ts')
      ) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

export const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

export type AllowEntry = { file: string; match: string; reason: string };

export function isAllowed(finding: Finding, allowlist: AllowEntry[]): boolean {
  return allowlist.some(
    (entry) => entry.file === finding.file && finding.snippet.includes(entry.match),
  );
}

export function formatFindings(findings: Finding[]): string {
  return [
    'Possible credential leak (NFR-005). A credential identifier reaches a log call, an Error message',
    'or a persisted column. Fix the code; only if the flagged text is provably not a credential, add an',
    'entry { file, match, reason } to tests/unit/security/no-secrets.allowlist.json.',
    ...findings.map((f) => `  ${f.file}:${f.line} [${f.kind}] ${f.snippet}`),
  ].join('\n');
}

/** Property names declared in `interface|type Name { ... }` (top-level members of that body). */
export function declaredFieldNames(source: string, typeName: string): string[] {
  const code = codeOnly(source);
  const header = new RegExp(`\\b(?:interface|type)\\s+${typeName}\\b[^{=]*(?:=\\s*)?\\{`);
  const match = header.exec(code);
  if (!match) return [];
  let depth = 1;
  let k = match.index + match[0].length;
  const start = k;
  for (; k < code.length && depth > 0; k += 1) {
    if (code[k] === '{') depth += 1;
    else if (code[k] === '}') depth -= 1;
  }
  const body = code.slice(start, k - 1);
  return [...body.matchAll(/(?:^|[;,{\n])\s*(?:readonly\s+)?(\w+)\??\s*:/g)].map((m) => m[1]!);
}

/** Every `name:` key inside the arguments of each `.json(` call. */
export function jsonResponseKeys(source: string): string[] {
  const code = codeOnly(source);
  const keys: string[] = [];
  for (const match of code.matchAll(/\.json\s*\(/g)) {
    const args = balancedParens(code, match.index + match[0].length - 1);
    for (const key of args.matchAll(/(?:^|[,{\s])(\w+)\s*:/g)) keys.push(key[1]!);
  }
  return keys;
}
