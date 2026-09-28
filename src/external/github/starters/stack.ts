// Reads an architecture option's stack descriptor (FR-020: frontend, backend,
// database, hosting, repository layout) into lowercase text per layer, so the
// starters can decide whether they fit it. The descriptor is free text written
// by the model ("Django REST Framework modular monolith", "React with
// TypeScript"), stored as `jsonb`, so nothing here assumes a field exists or is
// a string.

export interface StackText {
  frontend: string;
  backend: string;
  database: string;
  hosting: string;
  repositoryLayout: string;
  /** Every layer joined, for "does the stack mention X anywhere". */
  all: string;
}

function layerText(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (Array.isArray(value)) return value.map(layerText).filter(Boolean).join(' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function readStack(stack: unknown): StackText {
  const record =
    typeof stack === 'object' && stack !== null && !Array.isArray(stack)
      ? (stack as Record<string, unknown>)
      : {};
  const frontend = layerText(record.frontend);
  const backend = layerText(record.backend);
  const database = layerText(record.database);
  const hosting = layerText(record.hosting);
  const repositoryLayout = layerText(record.repositoryLayout);
  return {
    frontend,
    backend,
    database,
    hosting,
    repositoryLayout,
    all: [frontend, backend, database, hosting, repositoryLayout].filter(Boolean).join(' '),
  };
}
