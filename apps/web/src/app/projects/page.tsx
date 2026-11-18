import type { Metadata } from 'next';
import Link from 'next/link';
import { AddProjectForm } from '@/components/add-project-form';
import { listProjects } from '@/lib/factory';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await listProjects();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-muted-foreground">Repositories this factory can work on.</p>
      </div>

      <section aria-labelledby="add-project" className="rounded-2xl border bg-card p-5 shadow-xs">
        <h2 id="add-project" className="mb-4 text-base font-semibold">
          Add a project
        </h2>
        <AddProjectForm />
        <p className="mt-4 text-xs text-muted-foreground">
          Before you run tasks, draft and approve its profile:{' '}
          <code className="font-mono">factory profile init --project &lt;name&gt;</code>.
        </p>
      </section>

      <section aria-labelledby="registered" className="flex flex-col gap-2">
        <h2 id="registered" className="text-base font-semibold">
          Registered
        </h2>
        {!projects.ok ? (
          <p className="text-sm text-destructive">Projects unavailable: {projects.error}</p>
        ) : projects.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {projects.value.map((p) => (
              <li key={p.name}>
                <Link
                  href={`/projects/${p.name}/tasks/new`}
                  className="flex flex-col px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{p.repo}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
