import { GitPullRequest, Kanban, Palette } from 'lucide-react';
import { Reveal } from './motion/reveal';
import { StaggerGroup, StaggerItem } from './motion/stagger';

const INTEGRATIONS = [
  {
    icon: GitPullRequest,
    name: 'GitHub',
    body: 'Initialize a repo from the approved architecture, with current flags shown before you confirm.',
  },
  {
    icon: Kanban,
    name: 'Jira',
    body: 'Export the backlog as epics and stories, traced back to the requirements that produced them.',
  },
  {
    icon: Palette,
    name: 'Stitch',
    body: 'Generate UI screens from the approved specification, sandboxed until you accept them.',
  },
];

export function IntegrationsSection() {
  return (
    <section id="integrations" className="border-surface-dim bg-surface-container-low border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <Reveal className="max-w-2xl">
          <h2 className="text-display-sm text-on-surface">Ships where you already work.</h2>
          <p className="text-on-surface-variant mt-3 text-base leading-relaxed">
            Every export is a read of the same lineage graph — not a separate copy that can go
            stale.
          </p>
        </Reveal>

        <StaggerGroup className="mt-10 grid gap-5 sm:grid-cols-3">
          {INTEGRATIONS.map((integration) => (
            <StaggerItem
              key={integration.name}
              className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-lg border p-6 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <span className="bg-surface-container-low text-on-surface-variant flex size-9 items-center justify-center rounded-md">
                <integration.icon className="size-5" aria-hidden="true" strokeWidth={1.75} />
              </span>
              <h3 className="text-on-surface text-sm font-semibold">{integration.name}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{integration.body}</p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
