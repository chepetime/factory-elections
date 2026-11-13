"use client";

import { use, useEffect, useState } from "react";

type Task = { id: string; prompt: string; stage: string };
type State =
  { status: "loading" | "unavailable" } | { status: "ready"; tasks: Task[] };

export default function ProjectTasks({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = use(params);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/projects/${encodeURIComponent(project)}/tasks`;
    setState({ status: "loading" });
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`GET ${url} returned ${response.status}: ${body}`);
        }
        const tasks: Task[] = await response.json();
        if (!controller.signal.aborted) setState({ status: "ready", tasks });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(`GET ${url} could not load tasks`, error);
          setState({ status: "unavailable" });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [project]);

  return (
    <main className="content">
      <a href="/">Home</a>
      <h1>Tasks: {project}</h1>
      {state.status === "loading" && <p>Loading tasks…</p>}
      {state.status === "unavailable" && <p>Tasks unavailable</p>}
      {state.status === "ready" &&
        (state.tasks.length === 0 ? (
          <p>No tasks yet</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Prompt</th>
                <th scope="col">Stage</th>
              </tr>
            </thead>
            <tbody>
              {state.tasks.map((task, index) => (
                <tr key={`${task.id}-${index}`}>
                  <td>{task.id}</td>
                  <td>{task.prompt}</td>
                  <td>{task.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </main>
  );
}
