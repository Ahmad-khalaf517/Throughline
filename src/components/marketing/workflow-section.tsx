'use client';

import { motion, type Variants } from 'framer-motion';
import { ClipboardList, FileText, Layers, LayoutTemplate, ListTree } from 'lucide-react';
import { Reveal } from './motion/reveal';

const STAGES = [
  {
    icon: FileText,
    id: 'BRIEF',
    label: 'Project brief',
    body: 'The starting intent — goals, constraints, users.',
  },
  {
    icon: ClipboardList,
    id: 'REQ',
    label: 'Requirements',
    body: 'What the product must do, generated and reviewed.',
  },
  {
    icon: Layers,
    id: 'ARCH',
    label: 'Architecture',
    body: 'How it’s built — decisions traced to requirements.',
  },
  {
    icon: LayoutTemplate,
    id: 'UI',
    label: 'UI specification',
    body: 'Screens and flows traced to the architecture.',
  },
  {
    icon: ListTree,
    id: 'BACKLOG',
    label: 'Backlog',
    body: 'Stories traced to every artifact above them.',
  },
];

const EASE = [0.16, 1, 0.3, 1] as const;
const STEP = 0.12;

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STEP, delayChildren: 0.05 } },
};

const stageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
};

export function WorkflowSection() {
  return (
    <section id="workflow" className="border-surface-dim bg-surface border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <Reveal className="max-w-2xl">
          <h2 className="text-display-sm text-on-surface">
            One connected pipeline, not five documents.
          </h2>
          <p className="text-on-surface-variant mt-3 text-base leading-relaxed">
            Each stage is generated from the one before it, and every artifact keeps a pointer back
            to its source. Nothing here is a static export — the links stay live.
          </p>
        </Reveal>

        <motion.div
          className="mt-10 grid gap-0 sm:grid-cols-5"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={containerVariants}
        >
          {STAGES.map((stage, index) => (
            <motion.div
              key={stage.id}
              variants={stageVariants}
              className="relative flex flex-col items-start gap-3 py-4 sm:items-center sm:px-3 sm:text-center"
            >
              {index < STAGES.length - 1 && (
                <motion.span
                  aria-hidden="true"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.4, delay: (index + 1) * STEP + 0.15 }}
                  className="border-outline absolute top-9 left-5 h-[calc(100%-2.25rem)] w-px border-l-2 border-dashed sm:top-6 sm:left-1/2 sm:h-px sm:w-[calc(100%-2.5rem)] sm:border-t-2 sm:border-l-0"
                />
              )}
              <span className="border-surface-dim bg-surface-container-lowest text-primary-container relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border shadow-sm">
                <stage.icon className="size-5" aria-hidden="true" strokeWidth={2} />
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-mono-code text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
                  {stage.id}
                </span>
                <h3 className="text-on-surface text-sm font-semibold">{stage.label}</h3>
                <p className="text-on-surface-variant text-xs leading-relaxed sm:max-w-[10rem]">
                  {stage.body}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
