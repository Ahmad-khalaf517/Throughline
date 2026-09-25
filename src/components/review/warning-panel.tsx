'use client';

import { useMemo, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import type { ImpactRowDTO } from '@/lib/serialize';
import { FlaggedGlyph } from '@/components/status/status-badge';
import { cn } from '@/lib/utils';

interface WarningPanelProps {
  warnings: ImpactRowDTO[];
}

/**
 * The warning panel (E5-S6) - `GET /api/projects/:projectId/impact`'s
 * consumer (API Contracts section 6). Self-contained like
 * `ArtifactReviewScreen` (E5-S2): local `useState` only, no network call.
 * Acknowledging a row here is the *direct* acknowledgement path (independent
 * of approval - the approval-time override is a separate call,
 * `impact.acknowledgeGateBlockers` vs this screen's `impact.acknowledge`,
 * Module Boundaries 4.2) - it mutates local state only; wiring the real
 * `POST /api/impact/acknowledgements` call is E3-S11's swap-in, not this
 * story's.
 *
 * INV-022: direct and transitive impact are always rendered as two
 * separate, labeled sections - never flattened into one list. INV-023:
 * every row shows its actual dependency path, not just a flag. INV-024:
 * copy stays conservative ("potentially affected", "review recommended") -
 * never a flat claim that something is wrong.
 */
export function WarningPanel({ warnings: initialWarnings }: WarningPanelProps) {
  const [warnings, setWarnings] = useState<ImpactRowDTO[]>(initialWarnings);
  // Acknowledgement notes are optional (API Contracts section 6, unlike the
  // approval dialog's mandatory override note) and aren't part of
  // `ImpactRowDTO` - kept as separate local state, the same pattern
  // `ArtifactReviewScreen` uses for its `overrideNote`.
  const [notes, setNotes] = useState<Record<string, string>>({});

  function handleAcknowledge(subjectId: string, note: string) {
    setWarnings((current) =>
      current.map((row) => (row.subjectId === subjectId ? { ...row, acknowledged: true } : row)),
    );
    if (note) {
      setNotes((current) => ({ ...current, [subjectId]: note }));
    }
  }

  const directWarnings = useMemo(() => warnings.filter((row) => row.depth === 0), [warnings]);
  const transitiveWarnings = useMemo(() => warnings.filter((row) => row.depth > 0), [warnings]);
  const unacknowledgedCount = useMemo(
    () => warnings.filter((row) => !row.acknowledged).length,
    [warnings],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Three aggregate states, per the screen-kit's "no impact found" is a
          success state - it must not read as empty or broken. */}
      {warnings.length === 0 ? (
        <div className="border-surface-dim bg-surface-container-lowest flex items-start gap-2 rounded-xl border p-6">
          <CircleCheck
            className="text-status-approved-bg mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-on-surface text-sm font-medium">No impact issues found.</p>
        </div>
      ) : unacknowledgedCount === 0 ? (
        <div className="border-surface-dim bg-surface-container-lowest flex items-start gap-2 rounded-xl border p-6">
          <CircleCheck
            className="text-status-approved-bg mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-on-surface text-sm font-medium">
            All flagged items have been acknowledged.
          </p>
        </div>
      ) : (
        <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
          <p className="text-on-surface text-sm font-medium">
            {warnings.length} item{warnings.length === 1 ? '' : 's'} potentially affected ·{' '}
            {unacknowledgedCount} need{unacknowledgedCount === 1 ? 's' : ''} review.
          </p>
        </div>
      )}

      <WarningSection
        title="Direct impact"
        rows={directWarnings}
        notes={notes}
        onAcknowledge={handleAcknowledge}
        emptyLabel="No direct impact."
      />
      <WarningSection
        title="Transitive impact"
        rows={transitiveWarnings}
        notes={notes}
        onAcknowledge={handleAcknowledge}
        emptyLabel="No transitive impact."
      />
    </div>
  );
}

interface WarningSectionProps {
  title: string;
  rows: ImpactRowDTO[];
  notes: Record<string, string>;
  onAcknowledge: (subjectId: string, note: string) => void;
  emptyLabel: string;
}

function WarningSection({ title, rows, notes, onAcknowledge, emptyLabel }: WarningSectionProps) {
  const headingId = `${title.toLowerCase().replace(/\s+/g, '-')}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6"
    >
      <h2
        id={headingId}
        className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
      >
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-on-surface-variant mt-3 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <WarningRow
              key={row.subjectId}
              warning={row}
              note={notes[row.subjectId]}
              onAcknowledge={onAcknowledge}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface WarningRowProps {
  warning: ImpactRowDTO;
  note: string | undefined;
  onAcknowledge: (subjectId: string, note: string) => void;
}

function WarningRow({ warning, note, onAcknowledge }: WarningRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const textareaId = `ack-note-${warning.subjectId}`;

  // Human-readable subject label (last path entry, INV-023) styled per
  // `subjectKind` - an `item_version` subject is a display key (same
  // mono-badge treatment the rest of the app uses for display keys); an
  // `external_ref` subject is free text (e.g. "GitHub: README.md"), so it
  // reads as plain emphasis instead of a fake display key.
  const subjectLabel = warning.path[warning.path.length - 1] ?? warning.subjectId;
  const isItemVersionSubject = warning.subjectKind === 'item_version';

  function handleConfirm() {
    onAcknowledge(warning.subjectId, draftNote.trim());
    setExpanded(false);
    setDraftNote('');
  }

  function handleCancel() {
    setExpanded(false);
    setDraftNote('');
  }

  return (
    <li className="border-surface-dim bg-surface-container-low rounded-lg border p-3">
      <div className="flex items-start gap-2">
        {warning.acknowledged ? (
          <CircleCheck
            className="text-on-surface-variant mt-0.5 size-4 shrink-0 opacity-60"
            aria-hidden="true"
          />
        ) : (
          <FlaggedGlyph title={`${subjectLabel} needs review`} className="mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm leading-relaxed',
              warning.acknowledged ? 'text-on-surface-variant opacity-60' : 'text-on-surface',
            )}
          >
            {isItemVersionSubject ? (
              <span className="font-mono-code font-semibold">{subjectLabel}</span>
            ) : (
              <span className="font-semibold">{subjectLabel}</span>
            )}{' '}
            is potentially affected — review recommended.
          </p>
          {/* Inspectable dependency path, root to subject (INV-023). */}
          <p className="font-mono-code text-on-surface-variant mt-1 text-[11px]">
            {warning.path.join(' → ')}
          </p>
          <p className="text-on-surface-variant mt-1 text-[11px] font-medium">
            {warning.acknowledged ? 'Acknowledged' : 'Needs review'}
            {warning.acknowledged && note && (
              <span className="font-normal"> — &ldquo;{note}&rdquo;</span>
            )}
          </p>
        </div>
      </div>

      {!warning.acknowledged && (
        <div className="mt-2 pl-6">
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              Acknowledge
            </button>
          ) : (
            <div className="border-surface-dim flex flex-col gap-2 rounded-lg border p-3">
              <label
                htmlFor={textareaId}
                className="text-on-surface flex flex-col gap-1.5 text-xs font-medium"
              >
                Note (optional)
                <textarea
                  id={textareaId}
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      handleCancel();
                    }
                  }}
                  rows={2}
                  placeholder="Add context for this acknowledgement..."
                  className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:ring-primary mt-1 w-full resize-y rounded-lg border px-3 py-2 text-xs font-normal transition-colors focus:ring-1 focus:outline-none"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-lg px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
