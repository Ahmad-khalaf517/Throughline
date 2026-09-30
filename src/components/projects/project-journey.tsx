'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  FileText,
  GitBranch,
  Layers3,
  LayoutTemplate,
  ListTodo,
} from 'lucide-react';
import type { ArtifactType, ArtifactVersionStatus } from '@/lib/serialize';
import { StatusBadge } from '@/components/status/status-badge';

const STEPS: { type: ArtifactType; label: string; icon: typeof FileText }[] = [
  { type: 'requirements', label: 'Requirements', icon: ListTodo },
  { type: 'architecture', label: 'Architecture', icon: Layers3 },
  { type: 'ui_requirements', label: 'UI specification', icon: LayoutTemplate },
  { type: 'backlog', label: 'Backlog', icon: GitBranch },
];
const DOCUMENTS: { type: ArtifactType; label: string; icon: typeof FileText }[] = [
  { type: 'brd', label: 'BRD', icon: FileText },
  { type: 'erd', label: 'ERD', icon: FileText },
];

interface JourneyTile {
  type: ArtifactType;
  status: ArtifactVersionStatus | null;
}

export function ProjectJourney({ projectId, tiles }: { projectId: string; tiles: JourneyTile[] }) {
  const reduceMotion = useReducedMotion();
  const byType = new Map(tiles.map((tile) => [tile.type, tile]));
  let approvedInOrder = 0;
  for (const step of STEPS) {
    if (byType.get(step.type)?.status !== 'approved') break;
    approvedInOrder += 1;
  }
  const completed =
    approvedInOrder +
    1 + // The saved project brief is the first milestone.
    DOCUMENTS.filter((document) => byType.get(document.type)?.status === 'approved').length;
  const next = STEPS.find((step) => byType.get(step.type)?.status !== 'approved');
  const nextDocument = DOCUMENTS.find(
    (document) => byType.get(document.type)?.status !== 'approved',
  );
  const destination = next
    ? `/projects/${projectId}/artifacts/${next.type}`
    : nextDocument
      ? `/projects/${projectId}/artifacts/${nextDocument.type}`
      : `/projects/${projectId}/outputs`;

  return (
    <section aria-labelledby="journey-heading" className="app-card p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="app-kicker">Your path from idea to build</p>
          <h2
            id="journey-heading"
            className="app-display text-on-surface mt-2 text-[clamp(1.6rem,2.6vw,2.25rem)] leading-tight"
          >
            Project journey
          </h2>
          <p className="text-on-surface-variant mt-1 text-sm">
            Each milestone reflects a saved brief or a current approved artifact.
          </p>
        </div>
        <p className="font-mono-code text-primary text-xs font-semibold">
          {completed} / 7 milestones
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Project journey"
        aria-valuemin={0}
        aria-valuemax={7}
        aria-valuenow={completed}
        aria-valuetext={`${completed} of 7 milestones complete`}
        className="app-journey-track mt-6 h-1.5 overflow-hidden rounded-full"
      >
        <motion.div
          aria-hidden="true"
          className="app-journey-fill h-full w-full origin-left rounded-full"
          initial={reduceMotion ? false : { transform: 'scaleX(0)' }}
          animate={{ transform: `scaleX(${completed / 7})` }}
          transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.23, 1, 0.32, 1] }}
        />
      </div>

      <ol className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <li className="border-surface-dim bg-surface-container-lowest flex min-h-32 flex-col rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <FileText
              className="text-primary-container size-5"
              aria-hidden="true"
              strokeWidth={1.8}
            />
            <span className="font-mono-code text-on-surface-variant text-[10px]">01</span>
          </div>
          <p className="text-on-surface mt-auto pt-4 text-sm font-semibold">Brief</p>
          <p className="text-status-approved-text mt-1 inline-flex items-center gap-1 text-xs font-medium">
            <Check className="size-3.5" aria-hidden="true" /> Captured
          </p>
        </li>
        {STEPS.map((step, index) => {
          const tile = byType.get(step.type);
          const current = next?.type === step.type;
          const Icon = step.icon;
          return (
            <li key={step.type}>
              <Link
                href={`/projects/${projectId}/artifacts/${step.type}`}
                aria-label={`${step.label}: ${tile?.status ?? 'not generated'}. Open ${step.label}.`}
                className={`app-card-link flex min-h-32 flex-col rounded-lg border p-4 focus-visible:outline-none ${
                  current
                    ? 'border-primary-container bg-surface-container-low'
                    : 'border-surface-dim bg-surface-container-lowest'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon
                    className="text-primary-container size-5"
                    aria-hidden="true"
                    strokeWidth={1.8}
                  />
                  <span className="flex items-center gap-2">
                    {current && (
                      <motion.span
                        aria-hidden="true"
                        className="bg-primary-container size-1.5 rounded-full"
                        initial={reduceMotion ? false : { opacity: 0.25, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: reduceMotion ? 0 : 0.35, delay: 0.4 }}
                      />
                    )}
                    <span className="font-mono-code text-on-surface-variant text-[10px]">
                      0{index + 2}
                    </span>
                  </span>
                </div>
                <p className="text-on-surface mt-auto pt-4 text-sm font-semibold">{step.label}</p>
                <div className="mt-1 flex min-h-6 items-center">
                  {tile?.status ? (
                    <StatusBadge status={tile.status} />
                  ) : (
                    <span className="text-on-surface-variant text-xs">Not generated</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="border-surface-dim mt-6 border-t pt-5">
        <p className="text-on-surface-variant mb-3 text-xs font-medium">Generated documents</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DOCUMENTS.map((document) => {
            const tile = byType.get(document.type);
            const Icon = document.icon;
            return (
              <li key={document.type}>
                <Link
                  href={`/projects/${projectId}/artifacts/${document.type}`}
                  aria-label={`${document.label}: ${tile?.status ?? 'not generated'}. Open ${document.label}.`}
                  className="app-card-link border-surface-dim bg-surface-container-lowest flex items-center justify-between gap-3 rounded-lg border p-4 focus-visible:outline-none"
                >
                  <span className="text-on-surface inline-flex items-center gap-2 text-sm font-semibold">
                    <Icon className="text-primary-container size-5" aria-hidden="true" />
                    {document.label}
                  </span>
                  {tile?.status ? (
                    <StatusBadge status={tile.status} />
                  ) : (
                    <span className="text-on-surface-variant text-xs">Not generated</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <Link
        href={destination}
        className="text-primary hover:text-primary-container-hover focus-visible:ring-primary mt-5 inline-flex items-center gap-2 rounded-md text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {next
          ? `Continue with ${next.label}`
          : nextDocument
            ? `Continue with ${nextDocument.label}`
            : 'Explore your outputs'}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
