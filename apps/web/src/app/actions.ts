'use server';
// Task actions call the local backend, which shares the CLI driver and enforces every approval gate.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  clearBackgroundLog,
  executeTask,
  isProjectName,
  isTaskId,
  startTask,
  submitTaskRequest,
} from '@/lib/factory';
import { saveAssignment } from '@/lib/team';

export interface ActionState {
  error?: string;
  message?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function target(form: FormData): { project: string; id: string } | { error: string } {
  const project = field(form, 'project');
  const id = field(form, 'id');
  if (!isProjectName(project) || !isTaskId(id)) return { error: 'Invalid project or task.' };
  return { project, id };
}

function refresh(project: string, id?: string) {
  revalidatePath(`/projects/${project}/tasks`);
  if (id) revalidatePath(`/projects/${project}/tasks/${id}`);
}

export async function submitTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  const prompt = field(form, 'prompt');
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  if (!prompt) return { error: 'Describe the task.' };
  const created = await submitTaskRequest(project, prompt);
  if (!created.ok) return { error: created.error };
  const id = created.value;
  if (form.get('start') === 'on') {
    const started = await startTask({ project, id, action: 'run' });
    if (!started.ok) return { error: started.error };
  }
  refresh(project, id);
  redirect(`/projects/${project}/tasks/${id}`);
}

export async function runTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const started = await startTask({ ...t, action: 'run' });
  refresh(t.project, t.id);
  return started.ok ? { message: 'Started.' } : { error: started.error };
}

export async function reviseTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const note = field(form, 'note');
  if (!note) return { error: 'Say what should change.' };
  const started = await startTask({ ...t, action: 'revise', note });
  refresh(t.project, t.id);
  return started.ok ? { message: 'Revision started.' } : { error: started.error };
}

export async function approveTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const head = field(form, 'head');
  const note = field(form, 'note');
  const result = await executeTask({
    ...t,
    action: 'approve',
    head,
    note,
    accept_blocking: form.get('acceptBlocking') === 'on',
  });
  refresh(t.project, t.id);
  return result.ok ? { message: 'Approved.' } : { error: result.error };
}

export async function rejectTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const note = field(form, 'note');
  if (!note) return { error: 'Say why the change is rejected.' };
  const result = await executeTask({ ...t, action: 'reject', note });
  refresh(t.project, t.id);
  return result.ok ? { message: 'Rejected.' } : { error: result.error };
}

export async function openPullRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const result = await executeTask({ ...t, action: 'open-pr', draft: form.get('draft') === 'on' }, 300_000);
  refresh(t.project, t.id);
  return result.ok ? { message: `Opened ${result.value}` } : { error: result.error };
}

export async function dismissLog(form: FormData): Promise<void> {
  const t = target(form);
  if ('error' in t) return;
  await clearBackgroundLog(t.project, t.id);
  refresh(t.project, t.id);
}

/** Saves one team member's team and tags. Called directly from the team table. */
export async function assignMember(
  project: string,
  email: string,
  team: string | undefined,
  tags: string[],
): Promise<ActionState> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  if (typeof email !== 'string' || !email.includes('@') || !Array.isArray(tags))
    return { error: 'Invalid member.' };
  const saved = await saveAssignment(project, email, team, tags);
  if (!saved.ok) return { error: saved.error };
  revalidatePath(`/projects/${project}/team`);
  return { message: 'Saved.' };
}
