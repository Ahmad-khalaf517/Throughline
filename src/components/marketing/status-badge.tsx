'use client';

import { motion } from 'framer-motion';
import { Check, Pencil, Redo2, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The four real artifact_version.status values (ERD CHECK constraint) - never
 * a fifth "stale" state. Each is distinguished by shape/icon, not color alone.
 */
export type ArtifactStatus = 'draft' | 'approved' | 'superseded' | 'rejected';

/*
 * Colors copied verbatim from "Throughline - Project Dashboard Overview
 * (Semantic Status Colors)" - the Stitch screen that colors each status
 * semantically (green/neutral/grey/red) rather than monochrome. See the
 * --status-* tokens in globals.css.
 */
const STATUS_CONFIG: Record<
  ArtifactStatus,
  { label: string; icon: typeof Check; className: string }
> = {
  approved: {
    label: 'Approved',
    icon: Check,
    className: 'bg-status-approved-bg text-status-approved-text',
  },
  draft: {
    label: 'Draft',
    icon: Pencil,
    className:
      'border border-dashed border-status-draft-border bg-status-draft-bg text-status-draft-text',
  },
  superseded: {
    label: 'Superseded',
    icon: Redo2,
    className: 'bg-status-superseded-bg text-status-superseded-text',
  },
  rejected: {
    label: 'Rejected',
    icon: X,
    className: 'border border-status-rejected bg-status-rejected/5 text-status-rejected',
  },
};

interface StatusBadgeProps {
  status: ArtifactStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'font-mono-code inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
        config.className,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" strokeWidth={2.5} />
      {config.label}
    </span>
  );
}

/**
 * "Flagged" (INV-020) is a separate, computed-on-read dimension - it can be
 * true for an item that is otherwise approved. Always render as a distinct
 * glyph next to the status badge, never as a competing status value.
 */
export function FlaggedGlyph({ title, className }: { title: string; className?: string }) {
  return (
    <span
      className={cn('text-primary-container inline-flex items-center', className)}
      title={title}
    >
      <motion.span
        className="inline-flex"
        animate={{ opacity: [1, 0.55, 1], scale: [1, 1.08, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <TriangleAlert className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
      </motion.span>
      <span className="sr-only">{title}</span>
    </span>
  );
}
