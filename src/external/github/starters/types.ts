import type { StackText } from './stack';

// A starter is a small, pinned, deterministic set of files for one stack
// family. Deterministic on purpose: the GitHub preview lists exactly the files
// that will be written (FR-030), the same inputs always produce the same
// repository, and a starter can be run and tested like any other code - none
// of which holds for model-written code committed to a public repository.

export interface StarterContext {
  /** The normalized repository name (`[a-z0-9-]`), safe as a package/project slug. */
  repoName: string;
  /** The selected option's title. Free model text: never interpolate it into code raw. */
  title: string;
  stack: StackText;
}

export interface StarterFile {
  path: string;
  content: string;
}

export interface Starter {
  id: 'django' | 'nextjs';
  /** Shown to the user: "Django", "Next.js". */
  label: string;
  /** Whether this starter fits the stack closely enough to be used (FR-031). */
  matches(stack: StackText): boolean;
  files(context: StarterContext): StarterFile[];
  /** Markdown for the README's "Getting started" section (no heading). */
  gettingStarted(context: StarterContext): string;
  /**
   * Layers the stack names that this starter does NOT generate. Listed in the
   * README and the preview so the repository never implies more than it holds.
   */
  notScaffolded(stack: StackText): string[];
}

/** A string as a source-code literal in Python or TypeScript (JSON strings are valid in both). */
export function stringLiteral(value: string): string {
  return JSON.stringify(value);
}
