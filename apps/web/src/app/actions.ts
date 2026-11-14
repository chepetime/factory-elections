'use server';
// Task actions. Each one runs the same `factory` command a person would type, so every gate
// (approval bound to the shown commit, blocking findings, PR preconditions) is enforced by the CLI.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clearBackgroundLog, command, isProjectName, isTaskId, startBackground } from '@/lib/factory';

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
  const created = await command(['intake', '--project', project, prompt]);
  if (!created.ok) return { error: created.error };
  const id = created.value;
  if (form.get('start') === 'on') {
    const started = startBackground(project, id, 'Running classify → code → verify → review', [
      'run',
      '--project',
      project,
      '--id',
      id,
    ]);
    if (!started.ok) return { error: started.error };
  }
  refresh(project, id);
  redirect(`/projects/${project}/tasks/${id}`);
}

export async function runTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const started = startBackground(t.project, t.id, 'Running classify → code → verify → review', [
    'run',
    '--project',
    t.project,
    '--id',
    t.id,
  ]);
  refresh(t.project, t.id);
  return started.ok ? { message: 'Started.' } : { error: started.error };
}

export async function reviseTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const note = field(form, 'note');
  if (!note) return { error: 'Say what should change.' };
  const started = startBackground(t.project, t.id, 'Revising: code → verify → review', [
    'revise',
    '--project',
    t.project,
    '--id',
    t.id,
    '--note',
    note,
  ]);
  refresh(t.project, t.id);
  return started.ok ? { message: 'Revision started.' } : { error: started.error };
}

export async function approveTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const head = field(form, 'head');
  const note = field(form, 'note');
  const args = ['task', 'approve', '--project', t.project, '--id', t.id, '--head', head];
  if (note) args.push('--note', note);
  if (form.get('acceptBlocking') === 'on') args.push('--accept-blocking');
  const result = await command(args);
  refresh(t.project, t.id);
  return result.ok ? { message: 'Approved.' } : { error: result.error };
}

export async function rejectTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const note = field(form, 'note');
  if (!note) return { error: 'Say why the change is rejected.' };
  const result = await command(['task', 'reject', '--project', t.project, '--id', t.id, '--note', note]);
  refresh(t.project, t.id);
  return result.ok ? { message: 'Rejected.' } : { error: result.error };
}

export async function openPullRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const args = ['task', 'open-pr', '--project', t.project, '--id', t.id];
  if (form.get('draft') === 'on') args.push('--draft');
  const result = await command(args, 300_000);
  refresh(t.project, t.id);
  return result.ok ? { message: `Opened ${result.value}` } : { error: result.error };
}

export async function dismissLog(form: FormData): Promise<void> {
  const t = target(form);
  if ('error' in t) return;
  clearBackgroundLog(t.project, t.id);
  refresh(t.project, t.id);
}
