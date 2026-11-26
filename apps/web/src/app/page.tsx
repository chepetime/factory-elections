import type { Metadata } from 'next';
import { AddProjectForm } from '@/components/add-project-form';
import { HomePanel, HomeScene, ProjectCards, type HomeCard } from '@/components/home-projects';
import { listProjects, listTasks, type ProjectSummary } from '@/lib/factory';
import { listIssues } from '@/lib/issues';
import { profileStatus, type ProfileStatus } from '@/lib/settings';
import { projectStats, type ProjectStats } from '@/lib/workspace-home';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

interface Card {
  project: ProjectSummary;
  stats: ProjectStats;
  profile?: ProfileStatus['state'];
  /** What could not be read for this project. */
  missing: string[];
}

async function loadCard(project: ProjectSummary): Promise<Card> {
  const [runs, tasks, profile] = await Promise.all([
    listTasks(project.name),
    listIssues(project.name),
    profileStatus(project.name),
  ]);
  return {
    project,
    stats: projectStats(runs.ok ? runs.value : [], tasks.ok ? tasks.value.items : []),
    ...(profile.ok ? { profile: profile.value.state } : {}),
    missing: [!runs.ok && 'runs', !tasks.ok && 'tasks', !profile.ok && 'profile'].filter((m): m is string =>
      Boolean(m),
    ),
  };
}

const PROFILE_NOTE: Partial<Record<ProfileStatus['state'], string>> = {
  missing: 'No repo profile',
  draft: 'Profile awaits approval',
  invalid: 'Profile is invalid',
};

function toHomeCard({ project, stats, profile, missing }: Card): HomeCard {
  const note = profile ? PROFILE_NOTE[profile] : undefined;
  return {
    name: project.name,
    title: project.display_name || project.name,
    repo: project.repo,
    icon: project.icon || project.name[0] || '?',
    stats,
    ...(note ? { note } : {}),
    missing,
  };
}

/** The app homepage: every registered project as a card, on dithered waves on black. */
export default async function Home() {
  const projects = await listProjects();
  if (!projects.ok)
    return (
      <HomeScene>
        <HomePanel>
          <p className="text-sm text-destructive">Projects unavailable: {projects.error}</p>
        </HomePanel>
      </HomeScene>
    );
  if (projects.value.length === 0)
    return (
      <HomeScene>
        <HomePanel className="mx-auto mt-[10vh] w-full max-w-xl">
          <h2 className="text-lg font-semibold">No projects yet</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">Add a local repository to start.</p>
          <AddProjectForm />
        </HomePanel>
      </HomeScene>
    );
  const cards = await Promise.all(projects.value.map(loadCard));
  return (
    <HomeScene>
      <ProjectCards cards={cards.map(toHomeCard)} />
    </HomeScene>
  );
}
