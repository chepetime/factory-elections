import type { Metadata } from 'next';
import Link from 'next/link';
import { FolderGit2, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
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

/** The homepage frame: a title bar with the add action, and a scrolling body. */
function Frame({ count, children }: { count?: number; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <FolderGit2 aria-hidden="true" className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Projects</h1>
        {count !== undefined && <span className="text-sm text-muted-foreground tabular-nums">{count}</span>}
        <Link
          href="/projects"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          <Plus aria-hidden="true" className="size-4" /> Add project
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

/** The app homepage: every registered project with its numbers. */
export default async function Home() {
  const projects = await listProjects();
  if (!projects.ok)
    return (
      <Frame>
        <p className="text-sm text-destructive">Projects unavailable: {projects.error}</p>
      </Frame>
    );
  if (projects.value.length === 0)
    return (
      <Frame count={0}>
        <div className="mx-auto w-full max-w-xl pt-[10vh]">
          <h2 className="text-lg font-semibold">No projects yet</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">Add a local repository to start.</p>
          <AddProjectForm />
        </div>
      </Frame>
    );
  const cards = await Promise.all(projects.value.map(loadCard));
  return (
    <Frame count={cards.length}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.project.name} className="min-w-0">
            <ProjectCard {...card} />
          </li>
        ))}
      </ul>
    </Frame>
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
