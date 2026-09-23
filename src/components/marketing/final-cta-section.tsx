import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './motion/reveal';

export function FinalCtaSection() {
  return (
    <section className="bg-inverse-surface">
      <Reveal className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-display-sm text-inverse-on-surface">
            Start a project that remembers why.
          </h2>
          <p className="text-inverse-on-surface/70 mt-3 text-base leading-relaxed">
            Free to start. Bring a brief, get requirements, architecture, UI specs, and a backlog —
            all linked, all the way through.
          </p>
        </div>
        <Link
          href="/sign-up"
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary-container focus-visible:ring-offset-inverse-surface inline-flex shrink-0 items-center gap-1.5 rounded-md px-6 py-3 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
        >
          Start a project
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Reveal>
    </section>
  );
}
