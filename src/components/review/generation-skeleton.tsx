'use client';

import { useEffect, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Sparkles } from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1] as const;

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
};

// Purely a perceived-progress narrative - the generate call is a single POST
// that resolves once the whole model call + persistence finishes, so there is
// no real per-step signal from the server to reflect. Cycling this on a timer
// keeps the wait from reading as frozen without claiming progress we can't
// actually observe.
const STEPS = [
  'Reading the project brief…',
  'Drafting items…',
  'Checking dependencies…',
  'Finalizing the draft…',
];

function SkeletonCard() {
  return (
    <motion.li variants={cardVariants} className="border-surface-dim rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <div className="bg-surface-container-low h-4 w-14 animate-pulse rounded" />
        <div className="bg-surface-container-low h-3 w-20 animate-pulse rounded" />
      </div>
      <div className="bg-surface-container-low mt-3 h-4 w-4/5 animate-pulse rounded" />
      <div className="bg-surface-container-low mt-2 h-3 w-3/5 animate-pulse rounded" />
    </motion.li>
  );
}

interface GenerationSkeletonProps {
  artifactTypeName: string;
}

/**
 * Loading state shown while a `POST .../generate` call is in flight. Item
 * cards fade/slide in staggered rather than all at once, and the caption
 * below the heading cycles through generic steps - both purely perceived
 * progress (see the STEPS comment above), not a readout of real server state.
 */
export function GenerationSkeleton({ artifactTypeName }: GenerationSkeletonProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
    }, 1700);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <div role="status" aria-live="polite" className="flex items-center gap-2">
          <Sparkles className="text-primary-container size-4 animate-pulse" aria-hidden="true" />
          <p className="text-on-surface text-sm font-medium">Generating {artifactTypeName}…</p>
          <span className="sr-only">{STEPS[stepIndex]}</span>
        </div>
        <p className="text-on-surface-variant mt-1 text-xs" aria-hidden="true">
          {STEPS[stepIndex]}
        </p>
        <div className="bg-surface-container-low mt-4 h-6 w-1/3 animate-pulse rounded" />
      </div>
      <motion.ul
        initial="hidden"
        animate="show"
        variants={listVariants}
        aria-hidden="true"
        className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-6"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </motion.ul>
    </div>
  );
}
