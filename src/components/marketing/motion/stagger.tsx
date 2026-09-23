'use client';

import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

const EASE = [0.16, 1, 0.3, 1] as const;

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.04 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

const GROUP_TAGS = { div: motion.div, ol: motion.ol, ul: motion.ul } as const;
const ITEM_TAGS = { div: motion.div, li: motion.li } as const;

interface StaggerGroupProps {
  children: ReactNode;
  className?: string;
  as?: keyof typeof GROUP_TAGS;
}

/** Reveals its StaggerItem children one after another as the group scrolls into view. */
export function StaggerGroup({ children, className, as = 'div' }: StaggerGroupProps) {
  const Comp = GROUP_TAGS[as];
  return (
    <Comp
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      variants={containerVariants}
    >
      {children}
    </Comp>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  as?: keyof typeof ITEM_TAGS;
}

export function StaggerItem({ children, className, as = 'div' }: StaggerItemProps) {
  const Comp = ITEM_TAGS[as];
  return (
    <Comp className={className} variants={itemVariants}>
      {children}
    </Comp>
  );
}
