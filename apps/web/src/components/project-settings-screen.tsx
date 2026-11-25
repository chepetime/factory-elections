import { notFound } from 'next/navigation';
import { ProfileCheckView } from '@/components/profile-check';
import { ProjectSettingsForm } from '@/components/project-settings-form';
import { isProjectName, listProjects } from '@/lib/factory';
import { readProfileCheck } from '@/lib/profile-check';
import { profileStatus, projectSettings } from '@/lib/settings';
import { ProfileStatusRow } from '@/components/profile-status';

/** Loads one project's settings for both the settings page and the settings dialog. */
export async function ProjectSettingsScreen({ project }: { project: string }) {
  if (!isProjectName(project)) notFound();
  const [projects, settings, check, profile] = await Promise.all([
    listProjects(),
    projectSettings(project),
    readProfileCheck(project),
    profileStatus(project),
  ]);
  if (!projects.ok) return <p className="p-6 text-destructive">Projects unavailable: {projects.error}</p>;
  const registered = projects.value.find((p) => p.name === project);
  if (!registered) notFound();
  if (!settings.ok) return <p className="p-6 text-destructive">Settings unavailable: {settings.error}</p>;
  return (
    <ProjectSettingsForm
      project={project}
      repo={registered.repo}
      initial={settings.value}
      setupCheck={
        <div className="flex flex-col gap-4">
          {profile.ok ? (
            <ProfileStatusRow project={project} status={profile.value} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              Profile status unavailable: {profile.error}
            </p>
          )}
          {check.ok ? (
            <ProfileCheckView
              project={project}
              state={check.value}
              blocked={
                profile.ok && profile.value.state !== 'approved'
                  ? 'Approve the repo profile first.'
                  : undefined
              }
            />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              Setup check unavailable: {check.error}
            </p>
          )}
        </div>
      }
    />
  );
}
