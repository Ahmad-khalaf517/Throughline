'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/** Auto-simplifies every motion component in the tree when the OS asks for reduced motion. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
