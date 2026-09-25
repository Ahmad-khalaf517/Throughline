import { Bell, CircleCheck } from 'lucide-react';
import { Reveal } from './motion/reveal';
import { FlaggedGlyph, StatusBadge } from '@/components/status/status-badge';

export function ImpactSection() {
  return (
    <section id="impact" className="border-surface-dim bg-surface border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <h2 className="text-display-sm text-on-surface">Flagged is not blocked.</h2>
            <p className="text-on-surface-variant mt-3 text-base leading-relaxed">
              An approved item can still be flagged — that’s deliberate. Flagged is a separate
              signal layered on top of status, not a fifth state competing with it. You can approve
              from a flagged item, but only with the warning visible and an explicit decision.
            </p>
            <div className="text-on-surface-variant mt-6 flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-2.5">
                <CircleCheck
                  className="text-primary-container mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  Every external write — GitHub init, Jira export, Stitch generate — shows current
                  impact before you can confirm it.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <Bell
                  className="text-primary-container mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  Acknowledging a flag is one click — and it’s logged, so the decision has a record
                  too.
                </span>
              </div>
            </div>
          </Reveal>

          <Reveal
            delay={0.15}
            className="border-surface-dim bg-surface-container-lowest rounded-lg border shadow-sm"
          >
            <div className="border-surface-dim flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <span className="text-on-surface text-sm font-semibold">Project health</span>
              </div>
              <span className="border-outline-variant bg-surface-container-low font-mono-code text-primary rounded-md border px-2 py-0.5 text-[11px] font-medium">
                2 flagged items
              </span>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <div className="border-surface-dim bg-surface-container-low rounded-lg border p-4">
                <div className="flex items-start gap-2">
                  <FlaggedGlyph title="Flagged" className="mt-0.5" />
                  <p className="text-on-surface text-sm font-medium">
                    S-12 would be flagged: it depends on R-07 v2 (now v3).
                  </p>
                </div>
                <p className="text-on-surface-variant mt-2 pl-6 text-xs leading-relaxed">
                  Also impacts{' '}
                  <span className="font-mono-code text-on-surface font-medium">ADR-03</span>.
                  Downstream implementation tasks should be reviewed before sprint confirmation.
                </p>
              </div>

              <div className="border-surface-dim text-on-surface-variant flex items-center justify-between border-t pt-4 text-xs">
                <span>Requirement-to-code trace</span>
                <span className="font-mono-code text-on-surface font-semibold">98.4%</span>
              </div>
              <div className="text-on-surface-variant flex items-center justify-between text-xs">
                <span>Unresolved dependencies</span>
                <span className="font-mono-code text-primary-container font-semibold">2 items</span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <StatusBadge status="approved" />
                <FlaggedGlyph title="Approved but flagged" />
                <span className="text-on-surface-variant text-xs">
                  can still be true at the same time.
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
