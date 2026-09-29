import { ArrowUpRight, CheckCheck, GitCompareArrows, WandSparkles } from 'lucide-react';
import { Reveal } from './motion/reveal';
import { StaggerGroup, StaggerItem } from './motion/stagger';

const MOMENTS = [
  {
    number: '01',
    icon: WandSparkles,
    title: 'Start with the intent',
    body: 'Write the brief once. Throughline turns it into connected requirements, architecture, UI specifications, and backlog stories.',
    note: 'From an idea to a plan',
  },
  {
    number: '02',
    icon: CheckCheck,
    title: 'Keep people in control',
    body: 'Review every draft, compare revisions, and approve the decisions that should become the source of truth.',
    note: 'AI drafts · you decide',
  },
  {
    number: '03',
    icon: GitCompareArrows,
    title: 'Change without losing the why',
    body: 'When an upstream item changes, follow its impact through the plan before you send work to your tools.',
    note: 'Every dependency stays visible',
  },
] as const;

export function WorkflowSection() {
  return (
    <section id="workflow" className="border-surface-dim bg-surface scroll-mt-16 border-b">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
        <Reveal className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-16">
          <div>
            <p className="font-mono-code text-primary mb-4 text-[11px] font-semibold tracking-[0.16em] uppercase">
              The workflow
            </p>
            <h2 className="text-on-surface max-w-2xl text-[clamp(2.25rem,4vw,3.8rem)] leading-[1.06] font-semibold tracking-[-0.05em] text-balance">
              Move fast. Keep the thread.
            </h2>
          </div>
          <p className="text-on-surface-variant max-w-md text-base leading-relaxed">
            Planning is rarely a straight line. Throughline makes it safe to generate, review, and
            revise without losing what each decision depends on.
          </p>
        </Reveal>

        <StaggerGroup className="mt-12 grid gap-4 md:grid-cols-3" as="ol">
          {MOMENTS.map((moment) => (
            <StaggerItem
              key={moment.number}
              as="li"
              className="border-surface-dim bg-surface-container-lowest group hover:border-outline flex min-h-77 flex-col rounded-xl border p-6 transition-colors sm:p-7"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono-code text-primary text-xs font-semibold">
                  /{moment.number}
                </span>
                <moment.icon
                  className="text-primary-container size-6"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-auto pt-12">
                <h3 className="text-on-surface text-xl font-semibold tracking-[-0.035em]">
                  {moment.title}
                </h3>
                <p className="text-on-surface-variant mt-3 text-sm leading-[1.65]">{moment.body}</p>
                <p className="border-surface-dim font-mono-code text-on-surface-variant mt-7 flex items-center justify-between border-t pt-4 text-[10px] font-medium tracking-[0.04em] uppercase">
                  {moment.note}
                  <ArrowUpRight className="text-primary-container size-4" aria-hidden="true" />
                </p>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
