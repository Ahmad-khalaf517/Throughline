'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

const EASE = [0.23, 1, 0.32, 1] as const;

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}

/** Fades and slides a single block in the first time it scrolls into view. */
export function Reveal({ children, className, delay = 0, y = 16 }: RevealProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, transform: `translateY(${y}px)` }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
