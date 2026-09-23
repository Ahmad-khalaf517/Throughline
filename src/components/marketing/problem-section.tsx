import { FileQuestion, GitBranch, ShieldAlert } from 'lucide-react';
import { Reveal } from './motion/reveal';
import { StaggerGroup, StaggerItem } from './motion/stagger';

const PROBLEMS = [
  {
    icon: FileQuestion,
    title: 'Requirements drift silently',
    body: 'A requirement gets revised in a doc, a Slack thread, or someone’s head. Nothing tells the architecture or backlog that depended on the old version.',
  },
  {
    icon: GitBranch,
    title: 'Architecture forgets its "why"',
    body: 'Six months later, no one remembers which requirement justified a decision — or whether it still applies after the requirement changed.',
  },
  {
    icon: ShieldAlert,
    title: 'Approvals run on memory, not evidence',
    body: 'Reviewers approve a spec because it "looks right," not because they can see exactly what upstream changed and what it touches downstream.',
  },
];

export function ProblemSection() {
  return (
    <section className="border-surface-dim bg-surface-container-low border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <Reveal className="max-w-2xl">
          <h2 className="text-display-sm text-on-surface">Context loss is the default.</h2>
          <p className="text-on-surface-variant mt-3 text-base leading-relaxed">
            Planning artifacts are supposed to build on each other. In practice, the links between
            them live in memory — and memory doesn’t survive a revision.
          </p>
        </Reveal>

        <StaggerGroup className="mt-10 grid gap-5 sm:grid-cols-3">
          {PROBLEMS.map((problem) => (
            <StaggerItem
              key={problem.title}
              className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-lg border p-6 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <span className="bg-surface-container-low text-primary-container flex size-9 items-center justify-center rounded-md">
                <problem.icon className="size-5" aria-hidden="true" strokeWidth={2} />
              </span>
              <h3 className="text-on-surface text-sm font-semibold">{problem.title}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{problem.body}</p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
