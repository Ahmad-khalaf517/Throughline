import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getProjectById } from '@/artifact-lifecycle';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { DeleteProjectButton } from '@/components/projects/delete-project-dialog';
import { ProjectNavigation } from '@/components/projects/project-navigation';
import { ApiError } from '@/lib/errors';

export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<'/projects/[projectId]'>) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const { projectId } = await params;
  try {
    await requireProjectOwner(user.id, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div>
      <div className="project-page-chrome border-surface-dim bg-surface-container-lowest sticky top-16 z-30 border-b">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-20 min-w-0 items-center gap-4 py-3 sm:gap-6">
            <div className="min-w-0 flex-1">
              <Link
                href="/projects"
                className="text-on-surface-variant hover:text-primary focus-visible:ring-primary inline-flex rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                ← All projects
              </Link>
              <div className="mt-1 flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="bg-primary-container h-6 w-0.5 shrink-0 rounded-full"
                />
                <p
                  className="app-display text-on-surface truncate text-xl leading-tight sm:text-2xl"
                  title={project.name}
                >
                  {project.name}
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <DeleteProjectButton projectId={project.id} projectName={project.name} />
            </div>
          </div>
          <ProjectNavigation projectId={project.id} />
        </div>
      </div>
      {children}
    </div>
  );
}
