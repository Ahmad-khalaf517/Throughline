import { ArrowRight } from 'lucide-react';
import { Reveal } from './motion/reveal';
import { StaggerGroup, StaggerItem } from './motion/stagger';
import { FlaggedGlyph, StatusBadge } from './status-badge';

export function LineageSection() {
  return (
    <section id="lineage" className="border-surface-dim bg-surface-container-low border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div>
            <Reveal>
              <h2 className="text-display-sm text-on-surface">
                Direct impact. Transitive impact. A reason for both.
              </h2>
              <p className="text-on-surface-variant mt-3 max-w-xl text-base leading-relaxed">
                When R-07 moves from v2 to v3, Throughline doesn&rsquo;t just flag what points at it
                directly — it follows the chain, and it can always explain why a given item is on
                the list.
              </p>
            </Reveal>

            <StaggerGroup className="mt-8 flex flex-col gap-0 sm:flex-row sm:items-stretch sm:gap-0">
              <StaggerItem className="border-surface-dim bg-surface-container-lowest flex flex-1 flex-col gap-2 rounded-lg border p-4 shadow-sm">
                <span className="font-mono-code text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
                  Upstream change
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono-code border-surface-dim bg-surface-container-low text-primary rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                    R-07
                  </span>
                  <span className="font-mono-code text-on-surface-variant text-[11px]">
                    v2 → v3
                  </span>
                </div>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  Sync conflict resolution: acceptance criteria revised for offline merge.
                </p>
              </StaggerItem>

              <div className="flex items-center justify-center px-2 py-3 sm:py-0">
                <ArrowRight
                  className="text-outline size-4 rotate-90 sm:rotate-0"
                  aria-hidden="true"
                />
              </div>

              <StaggerItem className="border-surface-dim bg-surface-container-lowest flex flex-1 flex-col gap-2 rounded-lg border p-4 shadow-sm">
                <span className="font-mono-code text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
                  Direct impact
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-code border-surface-dim bg-surface-container-low text-on-surface-variant rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                    ADR-03
                  </span>
                  <StatusBadge status="approved" />
                  <FlaggedGlyph title="ADR-03 depends on R-07 v2, now v3" />
                </div>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  Local-first storage layer cites R-07 directly for its conflict semantics.
                </p>
              </StaggerItem>

              <div className="flex items-center justify-center px-2 py-3 sm:py-0">
                <ArrowRight
                  className="text-outline size-4 rotate-90 sm:rotate-0"
                  aria-hidden="true"
                />
              </div>

              <StaggerItem className="border-surface-dim bg-surface-container-lowest flex flex-1 flex-col gap-2 rounded-lg border p-4 shadow-sm">
                <span className="font-mono-code text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
                  Transitive impact
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-code border-surface-dim bg-surface-container-low text-on-surface-variant rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                    S-12
                  </span>
                  <StatusBadge status="draft" />
                  <FlaggedGlyph title="S-12 depends on ADR-03, which depends on R-07" />
                </div>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  Resolve a sync conflict inherits the flag through ADR-03, not from R-07 itself.
                </p>
              </StaggerItem>
            </StaggerGroup>
          </div>

          <Reveal delay={0.15}>
            <aside className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-lg border p-5 shadow-sm">
              <span className="font-mono-code text-primary-container text-[10px] font-semibold tracking-wider uppercase">
                Why it&rsquo;s flagged
              </span>
              <p className="text-on-surface text-sm leading-relaxed">
                &ldquo;S-12 would be flagged: it depends on R-07 v2 (now v3).&rdquo;
              </p>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                Every flag names the specific item and the specific reason — never a generic
                &ldquo;something changed.&rdquo; You can always trace it back to the exact upstream
                revision.
              </p>
            </aside>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
