'use client';

import { motion, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';
import { FlaggedGlyph, StatusBadge, type ArtifactStatus } from './status-badge';

export interface LineageNode {
  id: string;
  kind: string;
  title: string;
  version: string;
  status: ArtifactStatus;
  flagged?: boolean;
}

interface LineageChainProps {
  nodes: LineageNode[];
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const STEP = 0.16;

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STEP, delayChildren: 0.1 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, x: -14, scale: 0.97 },
  show: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.5, ease: EASE } },
};

const dotVariants: Variants = {
  hidden: { scale: 0 },
  show: { scale: 1, transition: { duration: 0.3, ease: EASE } },
};

/**
 * The literal "connected artifacts" visual from the hero direction: a
 * vertical chain of artifact cards joined by the same dashed dependency
 * line used in the Throughline logo mark. Animates in as a chain reaction
 * on mount - each node lands, then the link to the next one draws in.
 */
export function LineageChain({ nodes, className }: LineageChainProps) {
  return (
    <motion.ol
      className={cn('flex flex-col', className)}
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      {nodes.map((node, index) => {
        const isLast = index === nodes.length - 1;
        return (
          <motion.li key={node.id} variants={cardVariants}>
            <div className="border-surface-dim bg-surface-container-lowest flex items-start gap-3 rounded-lg border p-4 shadow-sm">
              <motion.span
                aria-hidden="true"
                variants={dotVariants}
                className="bg-primary-container mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-code border-surface-dim bg-surface-container-low text-on-surface-variant rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                    {node.id}
                  </span>
                  <span className="font-mono-code text-on-surface-variant text-[11px]">
                    {node.version}
                  </span>
                  <StatusBadge status={node.status} />
                  {node.flagged && (
                    <FlaggedGlyph title={`${node.id} is flagged: upstream dependency changed`} />
                  )}
                </div>
                <p className="text-on-surface text-sm font-medium">{node.title}</p>
                <p className="font-mono-code text-on-surface-variant text-[11px] tracking-wide uppercase">
                  {node.kind}
                </p>
              </div>
            </div>
            {!isLast && (
              <motion.div
                aria-hidden="true"
                className="border-outline ml-[22px] h-4 w-0 border-l-2 border-dashed"
                style={{ transformOrigin: 'top' }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.3, ease: EASE, delay: (index + 1) * STEP + 0.1 }}
              />
            )}
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
