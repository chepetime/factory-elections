export interface Task {
  id: string;
  project: string;
  repo: string;
  prompt: string;
  stage: "queued";
}

export function createTask(
  id: string,
  project: string,
  repo: string,
  prompt: string,
): Task {
  if (!/^[A-Za-z0-9_-]+$/.test(project))
    throw new Error("Invalid project name");
  if (!prompt.trim()) throw new Error("Prompt must not be empty");
  return { id, project, repo, prompt, stage: "queued" };
}
