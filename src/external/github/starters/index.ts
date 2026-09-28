// The starter registry (TR FR-031/032). `pickStarter` is the single decision
// "does this stack have a pinned starter": a match means scaffold mode, no
// match means docs-only, and never a starter forced onto a stack it does not
// fit ("must not silently create a mismatched codebase").
//
// Adding a stack family = adding a `Starter` here. Order matters: the first
// match wins, and the more specific starter goes first.
import { djangoStarter } from './django';
import { nextjsStarter } from './nextjs';
import { readStack } from './stack';
import type { Starter } from './types';

export type { Starter, StarterContext, StarterFile } from './types';
export { readStack } from './stack';

const STARTERS: readonly Starter[] = [djangoStarter, nextjsStarter];

/** The starter that fits an architecture option's stack descriptor, or `null` (docs-only). */
export function pickStarter(stack: unknown): Starter | null {
  const text = readStack(stack);
  return STARTERS.find((starter) => starter.matches(text)) ?? null;
}
