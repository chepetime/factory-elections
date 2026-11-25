import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AddProjectForm } from '@/components/add-project-form';
import { LocalTime } from '@/components/local-time';
import { listProjects, listTasks, type ProjectSummary } from '@/lib/factory';
import { listIssues } from '@/lib/issues';
import { profileStatus, type ProfileStatus } from '@/lib/settings';
import { projectStats, type ProjectStats } from '@/lib/workspace-home';
import { cn } from '@/lib/utils';

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

/** The app homepage: every registered project with its numbers. */
export default async function Home() {
  const projects = await listProjects();
  if (!projects.ok) return <p className="text-destructive">Projects unavailable: {projects.error}</p>;
  if (projects.value.length === 0)
    return (
      <div className="mx-auto w-full max-w-xl pt-[12vh]">
        <h1 className="text-2xl font-semibold">No projects yet</h1>
        <p className="mt-2 mb-6 text-muted-foreground">Add a local repository to start.</p>
        <AddProjectForm />
      </div>
    );
  const cards = await Promise.all(projects.value.map(loadCard));
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cards.length} {cards.length === 1 ? 'project' : 'projects'} on this machine
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" /> Add project
        </Link>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.project.name} className="min-w-0">
            <ProjectCard {...card} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectCard({ project, stats, profile, missing }: Card) {
  const title = project.display_name || project.name;
  const note = profile ? PROFILE_NOTE[profile] : undefined;
  const numbers = [
    { label: 'Open tasks', value: stats.openTasks },
    { label: 'Running', value: stats.running },
    { label: 'Needs you', value: stats.needsYou, alert: stats.needsYou > 0 },
    { label: 'PRs', value: stats.pullRequests },
  ];
  return (
    <Link
      href={`/projects/${encodeURIComponent(project.name)}`}
      className="flex h-full flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-sm font-semibold uppercase">
          {project.icon || project.name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={project.repo}>
            {project.repo}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-2">
        {numbers.map(({ label, value, alert }) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                'text-lg font-semibold tabular-nums',
                alert && 'text-orange-600 dark:text-orange-400',
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {stats.lastActivity ? (
          <span>
            Updated <LocalTime iso={stats.lastActivity} format="date-time" />
          </span>
        ) : (
          <span>No activity yet</span>
        )}
        <span>${stats.spendThisMonth.toFixed(2)} this month</span>
        {note && <span className="text-orange-600 dark:text-orange-400">{note}</span>}
        {missing.length > 0 && <span className="text-destructive">Could not read {missing.join(', ')}</span>}
      </div>
    </Link>
  );
}
