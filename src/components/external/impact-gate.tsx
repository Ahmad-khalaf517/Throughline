'use client';

import { CircleCheck } from 'lucide-react';
import type { ImpactRowDTO } from '@/lib/serialize';
import { splitImpact } from '@/lib/external-preview';
import { FlaggedGlyph } from '@/components/status/status-badge';

interface ImpactGateProps {
  impact: readonly ImpactRowDTO[];
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  /**
   * Disambiguates the confirmation checkbox's `id` - each of the three
   * panels renders exactly one `ImpactGate`, but the id must still be
   * unique per screen.
   */
  idPrefix: string;
}

/**
 * The shared FR-085 gate (E5-S9) - one component every external-write
 * preview (GitHub init, Jira export, Stitch generate) renders, so the rule
 * can't be lost on one screen built on a different day (screen-kit skill).
 *
 * Renders impact **above** the confirmation control; every caller is
 * expected to render this component **above** its own submit button
 * (screen-kit / FR-085: impact shown before the write can be confirmed).
 *
 * - `impact.length === 0`: the success state (screen-kit's "no impact
 *   found is a success state" rule) - never reads as empty or broken, and
 *   renders no checkbox at all (nothing to confirm).
 * - `impact.length > 0`: direct (INV-022, depth 0) and transitive (depth
 *   > 0) impact in two separate labeled sections, each row showing its
 *   inspectable dependency path (INV-023) in conservative language
 *   (INV-024), followed by a required, keyboard-operable confirmation
 *   checkbox. FR-085: the write is allowed, not blocked - this only
 *   confirms the warning was seen.
 */
export function ImpactGate({
  impact,
  acknowledged,
  onAcknowledgedChange,
  idPrefix,
}: ImpactGateProps) {
  if (impact.length === 0) {
    return (
      <div className="border-surface-dim bg-surface-container-lowest flex items-start gap-2 rounded-xl border p-4">
        <CircleCheck
          className="text-status-approved-bg mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <p className="text-on-surface text-sm font-medium">
          No impact found. Nothing this write is built from is flagged.
        </p>
      </div>
    );
  }

  const { direct, transitive } = splitImpact(impact);
  const checkboxId = `${idPrefix}-impact-acknowledged`;

  return (
    <div className="flex flex-col gap-4">
      <ImpactSection title="Direct impact" rows={direct} />
      <ImpactSection title="Transitive impact" rows={transitive} />

      <div className="border-outline-variant bg-surface-container-low flex items-start gap-2 rounded-xl border p-4">
        <input
          id={checkboxId}
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
          className="border-outline-variant text-primary-container focus-visible:ring-primary mt-0.5 size-4 shrink-0 rounded focus-visible:ring-2 focus-visible:outline-none"
        />
        <label htmlFor={checkboxId} className="text-on-surface text-sm leading-relaxed">
          I&apos;ve reviewed the impact shown above and want to continue. Creating from a flagged
          item is allowed - this confirms you&apos;ve seen the warning, it doesn&apos;t clear it
          (FR-085).
        </label>
      </div>
    </div>
  );
}

interface ImpactSectionProps {
  title: string;
  rows: ImpactRowDTO[];
}

function ImpactSection({ title, rows }: ImpactSectionProps) {
  const headingId = `${title.toLowerCase().replace(/\s+/g, '-')}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="border-surface-dim bg-surface-container-lowest rounded-xl border p-4"
    >
      <h3
        id={headingId}
        className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
      >
        {title} ({rows.length})
      </h3>
      {rows.length === 0 ? (
        <p className="text-on-surface-variant mt-2 text-sm">None.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((row) => (
            <ImpactRow key={row.subjectId} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ImpactRow({ row }: { row: ImpactRowDTO }) {
  // Same subject-label/styling convention as `warning-panel.tsx`'s
  // `WarningRow`: the last path entry (INV-023), mono-badge for an
  // `item_version` subject (a display key), plain emphasis for an
  // `external_ref` subject (free text, e.g. "GitHub: README.md").
  const subjectLabel = row.path[row.path.length - 1] ?? row.subjectId;
  const isItemVersionSubject = row.subjectKind === 'item_version';

  return (
    <li className="flex items-start gap-2">
      <FlaggedGlyph title={`${subjectLabel} needs review`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-on-surface text-sm leading-relaxed">
          {isItemVersionSubject ? (
            <span className="font-mono-code font-semibold">{subjectLabel}</span>
          ) : (
            <span className="font-semibold">{subjectLabel}</span>
          )}{' '}
          is potentially affected — review recommended.
        </p>
        {/* Inspectable dependency path, root to subject (INV-023). */}
        <p className="font-mono-code text-on-surface-variant mt-1 text-[11px]">
          {row.path.join(' → ')}
        </p>
      </div>
    </li>
  );
}
