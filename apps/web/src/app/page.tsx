import { cookies } from 'next/headers';
import { ProjectHome } from '@/components/project-home';
import { listProjects, listTasks } from '@/lib/factory';
import { gitUserName } from '@/lib/team';

export const dynamic = 'force-dynamic';

/** Home: the start screen of the last project you used (the app shell remembers it in a cookie). */
export default async function Home() {
  const projects = await listProjects();
  if (!projects.ok) return <p className="p-6 text-destructive">Projects unavailable: {projects.error}</p>;
  if (projects.value.length === 0)
    return (
      <div className="mx-auto max-w-xl px-6 pt-[20vh] text-center">
        <h1 className="text-2xl font-semibold">No projects yet</h1>
        <p className="mt-2 text-muted-foreground">
          Register a repository with <code>factory project add --name &lt;name&gt; --repo &lt;path&gt;</code>.
        </p>
      </div>
    );
  const remembered = (await cookies()).get('factory.lastProject')?.value;
  const project = projects.value.find((p) => p.name === remembered)?.name ?? projects.value[0]!.name;
  const [tasks, userName] = await Promise.all([listTasks(project), gitUserName(project)]);
  return <ProjectHome project={project} tasks={tasks.ok ? tasks.value : undefined} userName={userName} />;
}
