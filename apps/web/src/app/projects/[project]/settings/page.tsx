import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectSettingsForm } from '@/components/project-settings-form';
import { isProjectName, listProjects } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { projectSettings } from '@/lib/settings';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Settings') : 'Settings' };
}
export const dynamic = 'force-dynamic';

export default async function ProjectSettingsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const [projects, settings] = await Promise.all([listProjects(), projectSettings(project)]);
  if (!projects.ok) return <p className="p-6 text-destructive">Projects unavailable: {projects.error}</p>;
  const registered = projects.value.find((p) => p.name === project);
  if (!registered) notFound();
  if (!settings.ok) return <p className="p-6 text-destructive">Settings unavailable: {settings.error}</p>;
  return <ProjectSettingsForm project={project} repo={registered.repo} initial={settings.value} />;
}
