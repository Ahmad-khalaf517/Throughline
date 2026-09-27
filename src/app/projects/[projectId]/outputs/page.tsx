import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';

interface ProjectOutputsPageProps {
  params: Promise<{ projectId: string }>;
}

const CARDS = [
  {
    slug: 'github',
    title: 'GitHub',
    description: 'Initialize a repository from your architecture decisions.',
    sourceType: 'architecture',
    sourceLabel: 'Architecture',
    outputLabel: 'Repository',
  },
  {
    slug: 'jira',
    title: 'Jira',
    description: 'Export your planned Epics and Stories.',
    sourceType: 'backlog',
    sourceLabel: 'Backlog',
    outputLabel: 'Epics and Stories',
  },
  {
    slug: 'stitch',
    title: 'Stitch',
    description: 'Generate a prototype from your UI requirements.',
    sourceType: 'ui_requirements',
    sourceLabel: 'UI Requirements',
    outputLabel: 'UI prototype',
  },
] as const;

function ProviderIcon({ provider }: { provider: (typeof CARDS)[number]['slug'] }) {
  if (provider === 'github') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
        <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.77.61-3.36-1.18-3.36-1.18-.46-1.17-1.12-1.48-1.12-1.48-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.21-.25-4.54-1.11-4.54-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.6 9.6 0 0 1 12 6.84c.85 0 1.71.11 2.5.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.33 4.69-4.55 4.94.36.31.68.92.68 1.86v2.72c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
      </svg>
    );
  }

  if (provider === 'jira') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 fill-none stroke-current"
        strokeWidth="1.8"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m4 7 2 2 3-4M4 16l2 2 3-4M12 7h8M12 16h8"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m17 13 4 4-4 4-4-4 4-4Z" />
    </svg>
  );
}

/**
 * The external-write hub (E5-S9), modeled on the "Throughline - Outputs
 * Overview" Stitch screen. Auth guard / `notFound()` mapping copied from
 * `warnings/page.tsx` exactly (see that file's own comment for why
 * `requireProjectOwner`'s `ApiError('NOT_FOUND')` is caught explicitly).
 */
export default async function ProjectOutputsPage({ params }: ProjectOutputsPageProps) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const { projectId } = await params;

  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }

  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary w-fit rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        ← {project.name}
      </Link>

      <header>
        <h1 className="text-on-surface text-display-sm font-semibold">Outputs</h1>
        <p className="text-on-surface-variant mt-2 max-w-2xl text-sm leading-relaxed">
          Create external outputs for {project.name} from approved artifacts. Each preview shows
          current impact before you confirm a write.
        </p>
      </header>

      <section aria-label="External providers" className="grid gap-5 lg:grid-cols-3">
        {CARDS.map((card) => {
          const approvedVersionId = project.artifacts[card.sourceType].approvedVersionId;

          return (
            <article
              key={card.slug}
              className="border-surface-dim bg-surface-container-lowest flex flex-col rounded-xl border shadow-sm"
            >
              <div className="flex flex-1 flex-col gap-5 p-6">
                <div className="border-surface-container-low flex items-center gap-3 border-b pb-4">
                  <span className="bg-surface-container text-on-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                    <ProviderIcon provider={card.slug} />
                  </span>
                  <div>
                    <p className="text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
                      Provider
                    </p>
                    <h2 className="text-on-surface text-lg font-semibold">{card.title}</h2>
                  </div>
                </div>

                <div>
                  <p className="text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
                    {card.outputLabel}
                  </p>
                  <p className="text-on-surface mt-1 text-sm leading-relaxed">{card.description}</p>
                </div>

                <div className="bg-surface-container-low rounded-lg p-3">
                  <p className="text-on-surface-variant text-xs">Source artifact</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-on-surface text-sm font-medium">{card.sourceLabel}</span>
                    {approvedVersionId ? (
                      <span className="text-on-surface-variant inline-flex items-center gap-1.5 text-xs">
                        <span aria-hidden="true">✓</span> Approved source
                      </span>
                    ) : (
                      <span className="text-on-surface-variant inline-flex items-center gap-1.5 text-xs">
                        <span aria-hidden="true">○</span> No approved source yet
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-surface-container-low flex justify-end border-t p-4 sm:p-5">
                <Link
                  href={`/projects/${projectId}/outputs/${card.slug}`}
                  aria-label={`View ${card.title} preview`}
                  className="bg-surface-container hover:bg-surface-container-high text-on-surface focus-visible:ring-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none sm:w-auto"
                >
                  View preview <span aria-hidden="true">→</span>
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
