import { Reveal } from './motion/reveal';
import { StaggerGroup, StaggerItem } from './motion/stagger';
import { StatusBadge, type ArtifactStatus } from './status-badge';

const STATES: { status: ArtifactStatus; body: string }[] = [
  { status: 'draft', body: 'Generated, not yet reviewed.' },
  { status: 'approved', body: 'A human signed off — with or without a flag present.' },
  { status: 'superseded', body: 'Replaced by a newer version of the same item.' },
  { status: 'rejected', body: 'Explicitly turned down, with a reason attached.' },
];

export function ApprovalSection() {
  return (
    <section id="approval" className="border-surface-dim bg-surface border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div>
            <Reveal>
              <h2 className="text-display-sm text-on-surface">A human approves every artifact.</h2>
              <p className="text-on-surface-variant mt-3 max-w-xl text-base leading-relaxed">
                AI generates the draft. It never becomes the plan of record on its own. Four states,
                always visible, always distinguished by more than color:
              </p>
            </Reveal>

            <StaggerGroup className="mt-8 grid gap-4 sm:grid-cols-2">
              {STATES.map((s) => (
                <StaggerItem
                  key={s.status}
                  className="border-surface-dim bg-surface-container-lowest flex flex-col gap-2 rounded-lg border p-4 shadow-sm"
                >
                  <StatusBadge status={s.status} className="w-fit" />
                  <p className="text-on-surface-variant text-xs leading-relaxed">{s.body}</p>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>

          <Reveal delay={0.15}>
            <aside className="border-surface-dim bg-surface-container-lowest flex flex-col gap-4 rounded-lg border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-on-surface text-sm font-semibold">Approve anyway</h3>
                <span className="font-mono-code border-error/40 bg-error-container text-on-error-container rounded border px-1.5 py-0.5 text-[10px] font-medium">
                  Blocked
                </span>
              </div>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                S-12 would be flagged: it depends on R-07 v2 (now v3). Approving it anyway requires
                a reason — the field can’t be empty, and the confirm button stays disabled until it
                isn’t.
              </p>
              <label className="text-on-surface flex flex-col gap-1.5 text-xs font-medium">
                Override note (required)
                <textarea
                  readOnly
                  rows={2}
                  value="Acceptable: legacy sync path is being removed next sprint."
                  className="font-mono-code border-surface-dim bg-surface-container-low text-on-surface-variant focus-visible:ring-primary resize-none rounded-md border p-2 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled
                  className="border-surface-dim text-outline flex-1 rounded-md border px-3 py-2 text-xs font-medium"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  disabled
                  className="bg-primary-container text-on-primary-container flex-1 rounded-md px-3 py-2 text-xs font-medium opacity-60 shadow-sm"
                >
                  Approve anyway
                </button>
              </div>
            </aside>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
