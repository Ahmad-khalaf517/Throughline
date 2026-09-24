import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * Read-only project detail (E5-S1). No edit/PATCH UI here - that's a later
 * story. `requireProjectOwner` throws `ApiError('NOT_FOUND')` for both "no
 * such project" and "not this caller's project" (API Contracts 1.4, "404
 * never 403"); caught explicitly and turned into Next's own 404 via
 * `notFound()` rather than letting an ApiError bubble up unhandled.
 */
export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
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

  // Fixed locale + UTC so every viewer sees the same calendar day regardless
  // of the server's own locale/timezone (this is a Server Component - it has
  // no access to the viewer's); per-viewer local formatting is deferred, as
  // it would need a client component.
  const createdAt = project.createdAt.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href="/projects"
        className="text-on-surface-variant hover:text-on-surface text-sm font-medium"
      >
        ← All projects
      </Link>

      <div className="bg-surface-container-lowest border-surface-dim rounded-xl border p-6">
        <h1 className="text-on-surface text-display-sm font-semibold">{project.name}</h1>
        <p className="text-on-surface-variant mt-1 text-xs">
          Created <time dateTime={project.createdAt.toISOString()}>{createdAt}</time>
        </p>

        <h2 className="text-on-surface-variant mt-6 text-xs font-semibold tracking-wide uppercase">
          Brief
        </h2>
        <p className="text-on-surface mt-2 text-sm leading-relaxed whitespace-pre-wrap">
          {project.brief}
        </p>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href={`/projects/${project.id}/artifacts/requirements`}
            className="text-primary-container hover:text-primary-container-hover text-sm font-medium"
          >
            Review requirements →
          </Link>
          <Link
            href={`/projects/${project.id}/artifacts/architecture`}
            className="text-primary-container hover:text-primary-container-hover text-sm font-medium"
          >
            Architecture →
          </Link>
          <Link
            href={`/projects/${project.id}/artifacts/backlog`}
            className="text-primary-container hover:text-primary-container-hover text-sm font-medium"
          >
            Backlog →
          </Link>
          <Link
            href={`/projects/${project.id}/warnings`}
            className="text-primary-container hover:text-primary-container-hover text-sm font-medium"
          >
            Warnings →
          </Link>
          <Link
            href={`/projects/${project.id}/dependencies`}
            className="text-primary-container hover:text-primary-container-hover text-sm font-medium"
          >
            Dependencies →
          </Link>
        </div>
      </div>
    </main>
  );
}
