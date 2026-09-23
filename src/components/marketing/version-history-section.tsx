import { Reveal } from './motion/reveal';
import { StaggerGroup, StaggerItem } from './motion/stagger';
import { StatusBadge } from './status-badge';

const VERSIONS = [
  {
    version: 'v1',
    status: 'superseded' as const,
    note: 'Server timestamps decide conflicting writes.',
  },
  { version: 'v2', status: 'superseded' as const, note: 'Manual merge prompt on every conflict.' },
  { version: 'v3', status: 'approved' as const, note: 'Offline 3-way merge preserves both edits.' },
];

export function VersionHistorySection() {
  return (
    <section className="border-surface-dim bg-surface-container-low border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <Reveal>
              <h2 className="text-display-sm text-on-surface">
                Nothing gets overwritten. It gets superseded.
              </h2>
              <p className="text-on-surface-variant mt-3 text-base leading-relaxed">
                Every revision is a new version, not an edit in place. The old one stays readable,
                marked <span className="text-on-surface font-medium">superseded</span>, so you can
                always see what changed and when it stopped being current.
              </p>
            </Reveal>

            <StaggerGroup as="ol" className="mt-6 flex flex-col gap-3">
              {VERSIONS.map((v) => (
                <StaggerItem
                  as="li"
                  key={v.version}
                  className="border-surface-dim bg-surface-container-lowest flex items-center gap-3 rounded-lg border p-3 shadow-sm"
                >
                  <span className="font-mono-code text-on-surface-variant w-7 text-sm font-semibold">
                    {v.version}
                  </span>
                  <StatusBadge status={v.status} />
                  <span className="text-on-surface-variant text-xs">{v.note}</span>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>

          <Reveal
            delay={0.15}
            className="border-surface-dim bg-surface-container-lowest rounded-lg border shadow-sm"
          >
            <div className="border-surface-dim flex items-center gap-2 border-b p-4">
              <span className="text-on-surface text-sm font-semibold">Requirement diff: R-07</span>
              <span className="font-mono-code text-on-surface-variant text-[11px]">v2 vs v3</span>
            </div>
            <div className="p-4">
              <div className="font-mono-code border-surface-dim bg-surface-container-low flex flex-col gap-1.5 rounded-lg border p-3 text-[11px] leading-relaxed">
                <p className="text-on-surface-variant">Comparing R-07 v2 vs v3:</p>
                <p className="bg-error-container text-on-error-container rounded p-1.5">
                  &minus; Acceptance Criteria 3: Server timestamps decide wins on conflicting
                  updates.
                </p>
                <p className="bg-primary-container/10 text-primary rounded p-1.5 font-medium">
                  + Acceptance Criteria 3: Offline 3-way merge preserves simultaneous field edits.
                </p>
              </div>
              <p className="text-on-surface-variant mt-3 text-xs">
                Downstream story{' '}
                <span className="font-mono-code text-on-surface font-semibold">S-12</span> and
                decision{' '}
                <span className="font-mono-code text-on-surface font-semibold">ADR-03</span> are
                flagged to adopt this change.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
