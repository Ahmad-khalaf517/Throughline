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
    description: 'Initialize a repository from the approved Architecture.',
  },
  {
    slug: 'jira',
    title: 'Jira',
    description: 'Export the approved Backlog as Epics and Stories.',
  },
  {
    slug: 'stitch',
    title: 'Stitch',
    description: 'Generate a UI prototype from the approved UI Requirements.',
  },
] as const;

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
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← {project.name}
      </Link>

      <header className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h1 className="text-on-surface text-display-sm font-semibold">Outputs</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          Create external objects from this project&apos;s approved artifacts. Every write shows its
          current impact before you confirm (FR-085).
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <Link
            key={card.slug}
            href={`/projects/${projectId}/outputs/${card.slug}`}
            className="border-surface-dim bg-surface-container-lowest hover:bg-surface-container-low focus-visible:ring-primary rounded-xl border p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <h2 className="text-on-surface text-sm font-semibold">{card.title}</h2>
            <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">
              {card.description}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
