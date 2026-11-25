import type { Metadata } from 'next';
import ProjectHomePage from '@/app/projects/[project]/page';
import { ProjectSettingsScreen } from '@/components/project-settings-screen';
import { SettingsDialog } from '@/components/settings-dialog';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Settings') : 'Settings' };
}
export const dynamic = 'force-dynamic';

// A direct visit or a reload lands here: the project home with the settings dialog on top.
// Links inside the app open the dialog over the current page instead (app/@modal/(.)projects/...).
export default async function ProjectSettingsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  return (
    <>
      <ProjectHomePage params={params} />
      <SettingsDialog closeHref={`/projects/${project}`}>
        <ProjectSettingsScreen project={project} />
      </SettingsDialog>
    </>
  );
}
