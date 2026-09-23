import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LineageChain, type LineageNode } from './lineage-chain';
import { Reveal } from './motion/reveal';

const HERO_CHAIN: LineageNode[] = [
  {
    id: 'REQ-12',
    kind: 'Requirement',
    title: 'Secure authentication',
    version: 'v2',
    status: 'approved',
  },
  {
    id: 'ARCH-04',
    kind: 'Architecture',
    title: 'Authentication architecture',
    version: 'v2',
    status: 'approved',
    flagged: true,
  },
  {
    id: 'UI-07',
    kind: 'UI specification',
    title: 'Authenticated application shell',
    version: 'v1',
    status: 'draft',
    flagged: true,
  },
  {
    id: 'PROJ-21',
    kind: 'Backlog story',
    title: 'Authentication story',
    version: 'v1',
    status: 'draft',
  },
];

export function Hero() {
  return (
    <section className="border-surface-dim bg-surface border-b">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:py-28">
        <div className="flex flex-col gap-6">
          <Reveal delay={0}>
            <span className="border-surface-dim bg-surface-container-lowest font-mono-code text-on-surface-variant inline-flex w-fit items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-medium">
              <span className="bg-primary-container size-1.5 rounded-full" />
              Brief → Requirements → Architecture → UI spec → Backlog
            </span>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="text-display-md sm:text-display-lg text-on-surface">
              Every decision keeps its lineage.
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="text-on-surface-variant max-w-lg text-base leading-relaxed sm:text-lg">
              Throughline plans your software from brief to backlog with AI, and keeps every
              artifact linked to what it came from. Change a requirement, and it tells you exactly
              what downstream — and why.
            </p>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/sign-up"
                className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary inline-flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
              >
                Start a project
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/sign-in"
                className="border-surface-dim bg-surface-container-lowest text-on-surface hover:bg-surface-container-low focus-visible:ring-primary rounded-md border px-5 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]"
              >
                Sign in
              </Link>
            </div>
          </Reveal>
        </div>

        <div className="relative">
          <div className="bg-surface-container-low pointer-events-none absolute -inset-4 -z-10 rounded-2xl sm:-inset-6" />
          <div className="flex flex-col gap-3">
            <LineageChain nodes={HERO_CHAIN} />
            <Reveal delay={1.1} y={8}>
              <p className="border-surface-dim bg-surface-container-lowest text-on-surface-variant flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed shadow-sm">
                <span className="font-mono-code text-primary-container font-semibold">Impact:</span>
                REQ-12 moved to v2. ARCH-04 and UI-07 depend on it and are flagged for review before
                PROJ-21 can be approved.
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
