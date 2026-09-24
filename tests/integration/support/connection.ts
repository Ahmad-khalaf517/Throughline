import { inject } from 'vitest';
import postgres from 'postgres';
import './types'; // side-effect: augments vitest's ProvidedContext with pgConnectionUri

// Deliberately independent of src/db and src/lib/env.ts (this ticket's own
// gotcha): a plain postgres-js client pointed at the Testcontainers
// container's connection string, which tests/integration/support/global-
// setup.ts started once for the whole `integration` vitest project and
// exposed via Vitest's provide/inject context. Every test file opens (and
// closes) its own connection from this - never the setup connection itself.
export function connect(): ReturnType<typeof postgres> {
  const connectionUri = inject('pgConnectionUri');
  if (!connectionUri) {
    throw new Error(
      'No pgConnectionUri was provided by tests/integration/support/global-setup.ts - is ' +
        "vitest.config.ts's `integration` project still pointing `globalSetup` at it?",
    );
  }
  return postgres(connectionUri, { prepare: false });
}
