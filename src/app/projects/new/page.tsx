import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Check, FileText, GitBranch, Layers3 } from 'lucide-react';
import { getVerifiedUser } from '@/auth';
import { NewProjectForm } from '../new-project-form';

/**
 * The project-creation screen, split out of `/projects` (SCRUM-86) so that
 * page is a plain list rather than a list-plus-form hybrid. Same auth guard
 * pattern every other page here uses. `NewProjectForm` itself needs no
 * changes - it already redirects to `/projects/${body.id}` on success, which
 * works from either page it's rendered on.
 */
export default async function NewProjectPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Link
        href="/projects"
        className="text-on-surface-variant hover:text-primary focus-visible:ring-primary w-fit rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        ← All projects
      </Link>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <p className="app-kicker">01 / Start with a brief</p>
          <h1 className="app-display text-on-surface mt-3 max-w-lg text-[clamp(2.75rem,5vw,4.5rem)] leading-[1.05]">
            Give the idea a place to grow<span className="text-primary">.</span>
          </h1>
          <p className="text-on-surface-variant mt-5 max-w-md text-base leading-relaxed">
            A clear brief is the start of a traceable plan. Name the project and describe the
            problem you want to solve.
          </p>
          <div className="border-surface-dim mt-10 border-t pt-6">
            <p className="app-kicker">What happens next</p>
            <ol className="mt-5 space-y-5">
              <li className="flex items-start gap-3">
                <span className="app-accent-soft flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <FileText className="size-4" aria-hidden="true" />
                </span>
                <span className="text-on-surface-variant text-sm leading-relaxed">
                  <strong className="text-on-surface block font-semibold">
                    Capture the intent
                  </strong>
                  Keep the problem, users, and constraints together.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="app-accent-soft flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <Layers3 className="size-4" aria-hidden="true" />
                </span>
                <span className="text-on-surface-variant text-sm leading-relaxed">
                  <strong className="text-on-surface block font-semibold">Review the plan</strong>
                  Approve each generated artifact before it becomes the source of truth.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="app-accent-soft flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <GitBranch className="size-4" aria-hidden="true" />
                </span>
                <span className="text-on-surface-variant text-sm leading-relaxed">
                  <strong className="text-on-surface block font-semibold">Keep the lineage</strong>
                  Follow later changes through every decision and story.
                </span>
              </li>
            </ol>
          </div>
        </div>
        <div>
          <div className="text-status-approved-text mb-4 inline-flex items-center gap-2 text-xs font-medium">
            <Check className="size-4" aria-hidden="true" /> Brief can be refined before Requirements
            generation
          </div>
          <NewProjectForm />
        </div>
      </div>
    </main>
  );
}
