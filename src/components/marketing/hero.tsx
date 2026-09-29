'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  FileText,
  GitBranch,
  Layers3,
  LayoutTemplate,
  ListTodo,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

const STAGES = [
  {
    code: '01 / INPUT',
    title: 'Brief',
    detail: 'Your idea, users, and constraints.',
    icon: FileText,
  },
  {
    code: '02 / DEFINE',
    title: 'Requirements',
    detail: 'What the product must do.',
    icon: ListTodo,
  },
  { code: '03 / DECIDE', title: 'Architecture', detail: 'How each need is solved.', icon: Layers3 },
  {
    code: '04 / DESIGN',
    title: 'UI specification',
    detail: 'Screens traced to decisions.',
    icon: LayoutTemplate,
  },
  {
    code: '05 / BUILD',
    title: 'Backlog',
    detail: 'Stories with their reasons attached.',
    icon: GitBranch,
  },
] as const;

const EASE = [0.23, 1, 0.32, 1] as const;
const sequence: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.42, delayChildren: 0.28 } },
};
const stage: Variants = {
  hidden: { opacity: 0, transform: 'translateY(18px)' },
  show: { opacity: 1, transform: 'translateY(0px)', transition: { duration: 0.62, ease: EASE } },
};

export function Hero() {
  const reduceMotion = useReducedMotion();
  const [replay, setReplay] = useState(0);

  return (
    <section className="marketing-hero border-surface-dim relative isolate overflow-hidden border-b">
      <div
        className="marketing-hero-grid pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
      />
      <div className="mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 sm:pt-22 lg:px-8 lg:pt-28 lg:pb-28">
        <div className="grid gap-9 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.65fr)] lg:items-end lg:gap-16">
          <div>
            <p className="font-mono-code text-primary mb-6 flex items-center gap-3 text-[11px] font-semibold tracking-[0.16em] uppercase">
              <span className="bg-primary-container inline-block h-px w-8" />
              The connected way to build
            </p>
            <h1 className="text-on-surface max-w-4xl text-[clamp(3.25rem,7.5vw,6.75rem)] leading-[0.98] font-semibold tracking-[-0.065em] text-balance">
              Your next big idea, <span className="text-primary">without the lost context.</span>
            </h1>
          </div>
          <div className="lg:pb-2">
            <p className="text-on-surface-variant max-w-md text-base leading-[1.7] sm:text-lg">
              Go from a brief to a buildable plan. Throughline connects every requirement, decision,
              screen, and story so a change never leaves your team guessing.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex min-h-12 items-center gap-3 rounded-lg px-5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Start a project <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a
                href="#workflow"
                className="text-on-surface hover:bg-surface-container-low focus-visible:ring-primary inline-flex min-h-12 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                Explore the workflow <ArrowDownRight className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        <div className="marketing-trace mt-14 overflow-hidden rounded-2xl shadow-[0_28px_80px_-48px_rgba(30,25,21,0.55)] sm:mt-18">
          <div className="marketing-trace-topbar flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <span
                className="marketing-trace-beacon flex size-7 items-center justify-center rounded-md"
                aria-hidden="true"
              >
                <Sparkles className="size-3.5" />
              </span>
              <span className="font-mono-code text-[11px] font-semibold tracking-[0.14em] uppercase">
                A plan with a pulse
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReplay((value) => value + 1)}
              className="marketing-replay focus-visible:ring-primary-container inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
              aria-label="Replay the five planning steps"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" /> Replay sequence
            </button>
          </div>
          <motion.div
            key={`progress-${replay}`}
            aria-hidden="true"
            className="marketing-progress h-0.5 origin-left"
            initial={reduceMotion ? false : { transform: 'scaleX(0)' }}
            animate={{ transform: 'scaleX(1)' }}
            transition={{ duration: reduceMotion ? 0 : 2.45, ease: EASE }}
          />
          <div className="px-5 pt-7 pb-5 sm:px-7 sm:pt-9 sm:pb-7">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono-code marketing-trace-muted text-[10px] font-medium tracking-[0.14em] uppercase">
                One idea / five connected artifacts
              </p>
              <span className="marketing-trace-sync font-mono-code inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium">
                <Check className="size-3" aria-hidden="true" /> Lineage preserved
              </span>
            </div>
            <motion.ol
              key={replay}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-2"
              initial={reduceMotion ? false : 'hidden'}
              animate="show"
              variants={sequence}
              aria-label="From brief to backlog"
            >
              {STAGES.map((item, index) => (
                <motion.li
                  key={item.code}
                  variants={stage}
                  className="marketing-stage relative rounded-xl p-4 sm:min-h-47 lg:min-h-49"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-code marketing-trace-muted text-[10px] font-medium tracking-[0.12em]">
                      {item.code}
                    </span>
                    <span className="marketing-stage-icon flex size-8 items-center justify-center rounded-lg">
                      <item.icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="mt-5 sm:mt-8">
                    <h2 className="text-[15px] font-semibold tracking-[-0.02em]">{item.title}</h2>
                    <p className="marketing-trace-muted mt-1.5 max-w-42 text-xs leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                  {index < STAGES.length - 1 && (
                    <motion.span
                      aria-hidden="true"
                      className="marketing-connector absolute -right-3 bottom-7 z-10 hidden h-px w-4 origin-left lg:block"
                      initial={reduceMotion ? false : { transform: 'scaleX(0)' }}
                      animate={{ transform: 'scaleX(1)' }}
                      transition={{ duration: 0.35, delay: 0.63 + index * 0.42, ease: EASE }}
                    />
                  )}
                </motion.li>
              ))}
            </motion.ol>
            <motion.div
              key={`impact-${replay}`}
              className="marketing-impact mt-4 flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
              initial={reduceMotion ? false : { opacity: 0, transform: 'translateY(12px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              transition={{ duration: 0.6, delay: reduceMotion ? 0 : 2.5, ease: EASE }}
            >
              <div className="flex items-start gap-3">
                <span className="marketing-impact-mark flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <GitBranch className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-mono-code text-[10px] font-semibold tracking-[0.12em] uppercase">
                    And when something changes...
                  </p>
                  <p className="mt-1 text-sm leading-snug font-medium">
                    Revise a requirement. See the decisions and stories it affects.
                  </p>
                </div>
              </div>
              <span className="marketing-impact-pill font-mono-code inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold">
                R-07 v3 <ArrowRight className="size-3" aria-hidden="true" /> 2 items flagged
              </span>
            </motion.div>
          </div>
        </div>
        <p className="font-mono-code text-on-surface-variant mt-4 text-center text-[10px] tracking-[0.1em] uppercase">
          Every step has a source. Every change has a path.
        </p>
      </div>
    </section>
  );
}
