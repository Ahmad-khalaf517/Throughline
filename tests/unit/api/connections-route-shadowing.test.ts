import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerParamSchema } from '@/app/api/connections/schemas';

// In the App Router a static folder (connections/stitch/route.ts) shadows the
// dynamic connections/[provider]/route.ts for that path, so any method the
// dynamic route serves but the static one omits answers 405. The dynamic route
// serves DELETE (disconnect): every provider folder that has its own route.ts
// must therefore export DELETE too.
const CONNECTIONS_DIR = path.join(process.cwd(), 'src/app/api/connections');

describe('connections route shadowing', () => {
  it('the dynamic [provider] route serves DELETE', () => {
    const text = readFileSync(path.join(CONNECTIONS_DIR, '[provider]', 'route.ts'), 'utf8');
    expect(text).toMatch(/export\s+(async\s+)?function\s+DELETE\b/);
  });

  it.each(providerParamSchema.options)('a %s/route.ts, if present, exports DELETE', (provider) => {
    const file = path.join(CONNECTIONS_DIR, provider, 'route.ts');
    if (!existsSync(file)) return;
    expect(
      readFileSync(file, 'utf8'),
      `${provider}/route.ts shadows [provider]/route.ts and must export DELETE`,
    ).toMatch(/export\s+(async\s+)?function\s+DELETE\b/);
  });

  it('the stitch folder does own a route.ts (so the guard above is exercised)', () => {
    expect(existsSync(path.join(CONNECTIONS_DIR, 'stitch', 'route.ts'))).toBe(true);
  });
});
