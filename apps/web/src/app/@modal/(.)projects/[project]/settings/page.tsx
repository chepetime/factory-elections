import { ProjectSettingsScreen } from '@/components/project-settings-screen';
import { SettingsDialog } from '@/components/settings-dialog';

export const dynamic = 'force-dynamic';

export default async function ProjectSettingsModal({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  return (
    <SettingsDialog>
      <ProjectSettingsScreen project={project} />
    </SettingsDialog>
  );
}
