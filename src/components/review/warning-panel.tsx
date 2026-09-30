'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleCheck, GitBranch } from 'lucide-react';
import type { ImpactRowDTO } from '@/lib/serialize';
import { FlaggedGlyph } from '@/components/status/status-badge';

interface WarningPanelProps {
  warnings: ImpactRowDTO[];
}

function warningKey(row: ImpactRowDTO) {
  return `${row.subjectKind}:${row.subjectId}:${row.rootItemVersionId}`;
}

/** Group by obsolete root while keeping each acknowledgement cause-specific. */
export function WarningPanel({ warnings: initialWarnings }: WarningPanelProps) {
  const [warnings, setWarnings] = useState<ImpactRowDTO[]>(initialWarnings);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const groups = useMemo(() => {
    const byRoot = new Map<string, { rootDisplayKey: string; rows: ImpactRowDTO[] }>();
    for (const row of warnings) {
      const group = byRoot.get(row.rootItemVersionId);
      if (group) group.rows.push(row);
      else byRoot.set(row.rootItemVersionId, { rootDisplayKey: row.rootDisplayKey, rows: [row] });
    }
    return [...byRoot.entries()].map(([rootId, group]) => ({ rootId, ...group }));
  }, [warnings]);

  const directCount = warnings.filter((row) => row.depth === 0).length;
  const transitiveCount = warnings.length - directCount;
  const unacknowledgedCount = warnings.filter((row) => !row.acknowledged).length;

  function handleAcknowledge(rowKey: string, note: string) {
    setWarnings((current) =>
      current.map((row) => (warningKey(row) === rowKey ? { ...row, acknowledged: true } : row)),
    );
    if (note) setNotes((current) => ({ ...current, [rowKey]: note }));
  }

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="Impact summary"
        className="border-surface-dim bg-surface-container-lowest overflow-hidden rounded-lg border"
      >
        <div className="border-surface-dim flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-start gap-3">
            {warnings.length === 0 || unacknowledgedCount === 0 ? (
              <CircleCheck
                className="text-status-approved-bg mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <FlaggedGlyph title="Downstream impact needs review" className="mt-0.5" />
            )}
            <div>
              <p className="text-on-surface text-sm font-semibold">
                {warnings.length === 0
                  ? 'No impact issues found.'
                  : unacknowledgedCount === 0
                    ? 'All flagged items have been acknowledged.'
                    : `${warnings.length} impact warning${warnings.length === 1 ? '' : 's'} · review recommended`}
              </p>
              <p className="text-on-surface-variant mt-1 text-xs">
                {warnings.length === 0
                  ? 'No downstream items currently need review.'
                  : unacknowledgedCount === 0
                    ? 'The dependency paths remain available for inspection.'
                    : `${unacknowledgedCount} need${unacknowledgedCount === 1 ? 's' : ''} review. Inspect each path before acknowledging it.`}
              </p>
            </div>
          </div>
          {warnings.length > 0 && (
            <span className="font-mono-code text-on-surface-variant shrink-0 text-[11px] font-medium tabular-nums">
              {warnings.length - unacknowledgedCount}/{warnings.length} acknowledged
            </span>
          )}
        </div>
        <dl className="divide-surface-dim grid grid-cols-2 divide-x sm:grid-cols-4">
          <SummaryMetric label="Root sources" value={groups.length} />
          <SummaryMetric label="Direct" value={directCount} />
          <SummaryMetric label="Transitive" value={transitiveCount} />
          <SummaryMetric
            label="Max tier"
            value={warnings.length ? Math.max(...warnings.map((row) => row.depth + 1)) : 0}
          />
        </dl>
      </section>

      {groups.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <WarningSection
            title="Direct impact"
            rows={[]}
            notes={notes}
            onAcknowledge={handleAcknowledge}
            emptyLabel="No direct impact."
          />
          <WarningSection
            title="Transitive impact"
            rows={[]}
            notes={notes}
            onAcknowledge={handleAcknowledge}
            emptyLabel="No transitive impact."
          />
        </div>
      ) : (
        groups.map(({ rootId, rootDisplayKey, rows }) => {
          const direct = rows.filter((row) => row.depth === 0);
          const transitive = rows.filter((row) => row.depth > 0);
          return (
            <section
              key={rootId}
              aria-label={`Impact from ${rootDisplayKey}`}
              className="border-surface-dim bg-surface-container-lowest overflow-hidden rounded-lg border"
            >
              <div className="bg-surface-container-low border-surface-dim flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="border-outline-variant bg-surface-container-lowest text-primary-container flex size-8 shrink-0 items-center justify-center rounded-md border">
                    <GitBranch className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono-code text-on-surface-variant text-[10px] font-medium tracking-wide uppercase">
                      Root source
                    </p>
                    <h2 className="font-mono-code text-on-surface mt-0.5 text-sm font-semibold break-words">
                      {rootDisplayKey}
                    </h2>
                    <p className="text-on-surface-variant mt-1 text-xs leading-relaxed">
                      This upstream source changed or was removed. Downstream items are potentially
                      affected; review recommended.
                    </p>
                  </div>
                </div>
                <span className="font-mono-code text-on-surface-variant shrink-0 text-[11px] tabular-nums">
                  {rows.length} downstream
                </span>
              </div>
              <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
                <WarningSection
                  title="Direct impact"
                  rows={direct}
                  notes={notes}
                  onAcknowledge={handleAcknowledge}
                  emptyLabel="No direct impact from this source."
                />
                <WarningSection
                  title="Transitive impact"
                  rows={transitive}
                  notes={notes}
                  onAcknowledge={handleAcknowledge}
                  emptyLabel="No transitive impact from this source."
                />
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <dt className="font-mono-code text-on-surface-variant text-[10px] font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-on-surface mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

interface WarningSectionProps {
  title: string;
  rows: ImpactRowDTO[];
  notes: Record<string, string>;
  onAcknowledge: (rowKey: string, note: string) => void;
  emptyLabel: string;
}

function WarningSection({ title, rows, notes, onAcknowledge, emptyLabel }: WarningSectionProps) {
  return (
    <section className="min-w-0">
      <div className="border-surface-dim flex items-center justify-between gap-2 border-b pb-2">
        <h3 className="font-mono-code text-on-surface text-xs font-semibold uppercase">{title}</h3>
        <span className="font-mono-code text-on-surface-variant text-[11px] tabular-nums">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-on-surface-variant py-4 text-xs">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <WarningRow
              key={warningKey(row)}
              warning={row}
              note={notes[warningKey(row)]}
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
  onAcknowledge: (rowKey: string, note: string) => void;
}

function WarningRow({ warning, note, onAcknowledge }: WarningRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const acknowledgeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const rowKey = warningKey(warning);
  const textareaId = `ack-note-${warning.subjectKind}-${warning.subjectId}-${warning.rootItemVersionId}`;
  const subjectLabel = warning.path[warning.path.length - 1] ?? warning.subjectId;

  useEffect(() => {
    if (!expanded && returnFocus.current) {
      acknowledgeButton.current?.focus();
      returnFocus.current = false;
    }
  }, [expanded]);

  function handleCancel() {
    returnFocus.current = true;
    setExpanded(false);
    setDraftNote('');
  }

  function handleConfirm() {
    onAcknowledge(rowKey, draftNote.trim());
    setExpanded(false);
    setDraftNote('');
  }

  return (
    <li className="border-surface-dim bg-surface-container-low hover:border-outline-variant rounded-md border p-3 transition-colors">
      <div className="flex items-start gap-2">
        {warning.acknowledged ? (
          <CircleCheck
            className="text-status-approved-bg mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <FlaggedGlyph title={`${subjectLabel} needs review`} className="mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={
                warning.subjectKind === 'item_version'
                  ? 'font-mono-code text-on-surface text-xs font-semibold break-all'
                  : 'text-on-surface text-xs font-semibold break-words'
              }
            >
              {subjectLabel}
            </span>
            <span className="font-mono-code border-outline-variant text-on-surface-variant rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
              Tier {warning.depth + 1}
            </span>
          </div>
          <p className="text-on-surface-variant mt-1 text-xs leading-relaxed">
            Potentially affected by the upstream source; review recommended.
          </p>
        </div>
      </div>

      <div className="border-outline-variant mt-3 border-l-2 pl-3">
        <p className="font-mono-code text-on-surface-variant text-[10px] font-medium tracking-wide uppercase">
          Dependency path
        </p>
        <ol
          className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs"
          aria-label="Dependency path from root source to downstream item"
        >
          {warning.path.map((step, index) => (
            <li key={`${index}-${step}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && (
                <ArrowRight
                  className="text-on-surface-variant size-3 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span className="font-mono-code text-on-surface break-all">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-surface-dim mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="font-mono-code text-on-surface-variant text-[10px] font-medium uppercase">
          {warning.acknowledged ? '✓ Acknowledged' : '△ Needs review'}
        </span>
        {!warning.acknowledged && !expanded && (
          <button
            ref={acknowledgeButton}
            type="button"
            onClick={() => setExpanded(true)}
            className="border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container focus-visible:ring-primary rounded-md border px-2.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Acknowledge
          </button>
        )}
      </div>
      {warning.acknowledged && note && (
        <p className="text-on-surface-variant mt-2 text-xs break-words">Note: {note}</p>
      )}
      {!warning.acknowledged && expanded && (
        <div className="mt-3 flex flex-col gap-2">
          <label
            htmlFor={textareaId}
            className="font-mono-code text-on-surface-variant text-[10px] font-medium tracking-wide uppercase"
          >
            Note (optional)
          </label>
          <textarea
            autoFocus
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
            className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus-visible:ring-primary min-h-24 w-full resize-none rounded-md border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary rounded-md px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-md px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
