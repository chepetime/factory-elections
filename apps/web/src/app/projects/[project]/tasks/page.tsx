import Link from 'next/link';
import { notFound } from 'next/navigation';
import { submitTask } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { StageBadge } from '@/components/stage-badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isProjectName, listTasks } from '@/lib/factory';

export const dynamic = 'force-dynamic';

export default async function ProjectTasks({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const tasks = await listTasks(project);
  const sorted = tasks.ok
    ? [...tasks.value].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← All projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Tasks: {project}</h1>
      </div>

      <section aria-labelledby="new-task" className="rounded-xl border p-4">
        <h2 id="new-task" className="mb-3 font-medium">
          New task
        </h2>
        <ActionForm action={submitTask} hidden={{ project }} submit="Submit task" pendingLabel="Submitting…">
          <Label htmlFor="prompt" className="sr-only">
            Task
          </Label>
          <Textarea
            id="prompt"
            name="prompt"
            required
            rows={3}
            placeholder="Describe one change for this repository, e.g. “Add a --verbose flag to the export command, with a test.”"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="start" defaultChecked /> Start the run now (classify, code, verify,
            review — stops at your approval)
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="task-list">
        <h2 id="task-list" className="sr-only">
          Tasks
        </h2>
        {!tasks.ok ? (
          <p className="text-destructive">Tasks unavailable</p>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground">No tasks yet</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {sorted.map((task) => (
              <li key={task.id} className="flex flex-col gap-1 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/projects/${project}/tasks/${task.id}`}
                    className="line-clamp-2 font-medium hover:underline"
                  >
                    {task.prompt}
                  </Link>
                  <StageBadge stage={task.stage} />
                </div>
                <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
                {task.verdict ? (
                  <div className="text-sm">
                    <span>Readiness: {task.verdict.readiness}</span>
                    {task.verdict.blockers.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {task.verdict.blockers.map((b, i) => (
                          <li key={i}>
                            {b.kind}: {b.question}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not classified</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
