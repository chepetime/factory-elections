import type { Metadata } from 'next';
import { ProjectSettingsScreen } from '@/components/project-settings-screen';
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

// A direct visit or a reload lands here; links inside the app open the same panel as a dialog
// (app/@modal/(.)projects/[project]/settings).
export default async function ProjectSettingsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  return (
    <div className="mx-auto flex h-[calc(100dvh-7.5rem)] min-h-[32rem] max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background min-[900px]:h-[calc(100dvh-4.5rem)]">
      <ProjectSettingsScreen project={project} />
    </div>
  );
}
