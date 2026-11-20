'use server';
// Task actions call the local backend, which shares the CLI driver and enforces every approval gate.
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  addProjectRequest,
  clearBackgroundLog,
  stopBackgroundRun,
  executeTask,
  isProjectName,
  isTaskId,
  startTask,
  submitTaskRequest,
} from '@/lib/factory';
import { startProfileCheck } from '@/lib/profile-check';
import { saveAssignment } from '@/lib/team';
import {
  isPrNumber,
  removeReviewRun,
  sendReviewMessageRun,
  startReviewRuns,
  stopReviewRun,
} from '@/lib/reviews';
import { detectProjectSettingsRun, saveProjectSettingsRun, type SettingsProposal } from '@/lib/settings';

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

export async function addProject(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = field(form, 'name');
  const repo = field(form, 'repo');
  if (!isProjectName(name))
    return { error: 'Use only letters, numbers, hyphens and underscores in the name.' };
  if (!repo.startsWith('/')) return { error: 'Enter the absolute path of the repository.' };
  const added = await addProjectRequest(name, repo);
  if (!added.ok) return { error: added.error };
  // The server-rendered home opens the remembered project; make that the new one.
  (await cookies()).set('factory.lastProject', name, { path: '/', maxAge: 31_536_000, sameSite: 'lax' });
  revalidatePath('/', 'layout');
  redirect(`/projects/${name}/tasks/new`);
}

export async function submitTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  const prompt = field(form, 'prompt');
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  if (!prompt) return { error: 'Describe the task.' };
  const created = await submitTaskRequest(project, prompt, field(form, 'jira_key') || undefined);
  if (!created.ok) return { error: created.error };
  const id = created.value;
  if (form.get('start') === 'on') {
    const started = await startTask({ project, id, action: 'run' });
    if (!started.ok) {
      // Creation succeeded. Navigate to that durable task instead of inviting duplicate submission.
      refresh(project, id);
      redirect(`/projects/${project}/tasks/${id}?start=failed`);
    }
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

/** Approves exactly this commit, then pushes the branch and opens a draft pull request. */
export async function approveAndOpenPullRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const approved = await executeTask({
    ...t,
    action: 'approve',
    head: field(form, 'head'),
    note: field(form, 'note'),
    accept_blocking: form.get('acceptBlocking') === 'on',
  });
  if (!approved.ok) {
    refresh(t.project, t.id);
    return { error: approved.error };
  }
  const opened = await executeTask({ ...t, action: 'open-pr', draft: true }, 300_000);
  refresh(t.project, t.id);
  return opened.ok
    ? { message: `Opened ${opened.value}` }
    : { error: `Approved, but the pull request did not open: ${opened.error}` };
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

export async function stopTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const result = await stopBackgroundRun(t.project, t.id);
  refresh(t.project, t.id);
  return result.ok ? { message: result.value } : { error: result.error };
}

/** Starts the project's "Check setup" run: preflight, setup and checks with no model call. */
export async function checkProjectSetup(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await startProfileCheck(project);
  revalidatePath(`/projects/${project}/settings`);
  return result.ok ? { message: 'Checking the setup…' } : { error: result.error };
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

/** Starts a review (or re-review) of each selected PR. Called directly from the PR reviews table. */
export async function startReviews(
  project: string,
  numbers: number[],
  mode: 'review' | 'rereview',
): Promise<ActionState & { failed?: { number: number; error: string }[] }> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  if (!Array.isArray(numbers) || numbers.length === 0 || numbers.length > 20 || !numbers.every(isPrNumber))
    return { error: 'Select between 1 and 20 pull requests.' };
  if (mode !== 'review' && mode !== 'rereview') return { error: 'Invalid review mode.' };
  const started = await startReviewRuns(project, numbers, mode);
  revalidatePath(`/projects/${project}/reviews`);
  if (!started.ok) return { error: started.error };
  const failed = started.value.flatMap((r) =>
    r.ok ? [] : [{ number: r.number, error: r.error ?? 'Failed' }],
  );
  const count = started.value.length - failed.length;
  return {
    message: count ? `Started ${count} review${count === 1 ? '' : 's'}.` : undefined,
    failed: failed.length ? failed : undefined,
  };
}

export async function stopReview(project: string, number: number): Promise<ActionState> {
  if (!isProjectName(project) || !isPrNumber(number)) return { error: 'Invalid pull request.' };
  const stopped = await stopReviewRun(project, number);
  revalidatePath(`/projects/${project}/reviews`);
  return stopped.ok ? { message: `Stopped #${number}.` } : { error: stopped.error };
}

export async function removeReview(project: string, number: number): Promise<ActionState> {
  if (!isProjectName(project) || !isPrNumber(number)) return { error: 'Invalid pull request.' };
  const removed = await removeReviewRun(project, number);
  revalidatePath(`/projects/${project}/reviews`);
  return removed.ok ? { message: `Removed the review of #${number}.` } : { error: removed.error };
}

/** Sends a follow-up message to a PR review chat. */
export async function sendReviewMessage(project: string, number: number, text: string): Promise<ActionState> {
  if (!isProjectName(project) || !isPrNumber(number)) return { error: 'Invalid pull request.' };
  if (typeof text !== 'string' || !text.trim()) return { error: 'Write a message.' };
  const sent = await sendReviewMessageRun(project, number, text.trim());
  revalidatePath(`/projects/${project}/reviews/${number}`);
  return sent.ok ? { message: 'Sent.' } : { error: sent.error };
}

/** Saves the project settings form. Only the known fields are sent; the backend validates them. */
export async function saveProjectSettings(project: string, settings: unknown): Promise<ActionState> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const saved = await saveProjectSettingsRun(project, settings);
  revalidatePath('/', 'layout');
  return saved.ok ? { message: 'Saved.' } : { error: saved.error };
}

/** Asks an agent to explore the repository and propose settings. Nothing is saved. */
export async function detectProjectSettings(
  project: string,
): Promise<{ error?: string; proposal?: SettingsProposal }> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const detected = await detectProjectSettingsRun(project);
  return detected.ok ? { proposal: detected.value } : { error: detected.error };
}

export async function featureGateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  const id = field(form, 'id');
  const action = field(form, 'action');
  if (
    !isProjectName(project) ||
    !/^[a-z0-9][a-z0-9-]{2,40}$/.test(id) ||
    !['approve-spec', 'plan', 'approve-board'].includes(action)
  )
    return { error: 'Invalid feature action.' };
  try {
    const { backendCall } = await import('@factory/backend/client');
    await backendCall('FeatureAction', {
      project,
      json: JSON.stringify({
        id,
        action,
        ...(action === 'approve-board' ? { mirror: form.get('mirror') === 'on' } : {}),
      }),
    });
    revalidatePath(`/projects/${project}/features/${id}`);
    return { message: action === 'plan' ? 'Planning started. Refresh to check progress.' : 'Approved.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update feature.' };
  }
}

export async function dismissInboxItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = field(form, 'id');
  const project = field(form, 'project');
  if (!id || id.length > 400 || !isProjectName(project)) return { error: 'Invalid inbox item.' };
  try {
    const { backendCall } = await import('@factory/backend/client');
    await backendCall('DismissInboxItem', { project, json: JSON.stringify({ id }) });
    revalidatePath('/', 'layout');
    return { message: 'Dismissed.' };
  } catch {
    return { error: 'Could not dismiss this item. Try again.' };
  }
}
