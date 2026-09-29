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
      <div className="border-surface-dim bg-surface-container-lowest sticky top-16 z-30 border-b">
        <div className="mx-auto max-w-[1200px] px-4 pt-5 sm:px-6 lg:px-8">
          <Link
            href="/projects"
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary inline-flex rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            ← All projects
          </Link>
          <div className="mt-2 flex items-center gap-3 pb-3">
            <span aria-hidden="true" className="bg-primary-container size-2.5 rounded-full" />
            <div className="min-w-0">
              <p className="app-kicker">Project workspace</p>
              <p className="app-display text-on-surface truncate text-2xl leading-tight">
                {project.name}
              </p>
            </div>
            <div className="ml-auto shrink-0">
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
