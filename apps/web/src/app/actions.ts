'use server';
// Task actions call the local backend, which shares the CLI driver and enforces every approval gate.
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  addProjectRequest,
  clearBackgroundLog,
  confirmRunCleanup,
  stopBackgroundRun,
  executeTask,
  isProjectName,
  isTaskId,
  startTask,
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
import {
  detectProjectSettingsRun,
  approveProfileRun,
  draftProfileRun,
  saveProjectSettingsRun,
  type SettingsProposal,
} from '@/lib/settings';
import {
  archiveIssueRun,
  commentIssueRun,
  createIssueRun,
  deleteIssueRun,
  followUpIssueRun,
  moveIssueRun,
  updateIssueRun,
} from '@/lib/issues';
import { HOME_BACKGROUNDS, IssueStatus, type HomeBackground } from '@factory/core';
import { saveUserSettingsRun, userSettings, type UserSettings } from '@/lib/user-settings';

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
  const jiraKey = field(form, 'jira_key') || undefined;
  // A new task lands on the board. "Start" puts it in Todo, where its agent (or the one the
  // coordinator picks) takes it up; otherwise it waits in Backlog. No pipeline run starts here.
  const status = form.get('start') === 'on' ? 'todo' : 'backlog';
  const line =
    field(form, 'title') ||
    (prompt
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ??
      prompt);
  // The description is your text. A preset that changes the job (a ticket, a review) adds its
  // instructions below it; the default "work on task" preset adds nothing an agent lacks.
  const body = field(form, 'body') || prompt;
  const instructions = field(form, 'instructions');
  const issue = await createIssueRun(project, {
    title: line.length > 200 ? `${line.slice(0, 199)}…` : line,
    description: instructions ? `${body}\n\n**Instructions:** ${instructions}` : body,
    status,
    jira_key: jiraKey,
  });
  if (!issue.ok) return { error: issue.error };
  revalidatePath(`/projects/${project}`, 'layout');
  redirect(`/projects/${project}/tasks/${issue.value.key}`);
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

export async function confirmCleanup(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = target(form);
  if ('error' in t) return t;
  const result = await confirmRunCleanup(t.project, t.id);
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
): Promise<{ error?: string; proposal?: SettingsProposal; drafted?: boolean }> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  // A missing repo profile is part of what the repository can fill in; it is drafted, never replaced.
  const [detected, profile] = await Promise.all([
    detectProjectSettingsRun(project),
    draftProfileRun(project),
  ]);
  if (profile.ok) revalidatePath(`/projects/${project}/settings`);
  const drafted = profile.ok && profile.value.state === 'draft';
  return detected.ok ? { proposal: detected.value, drafted } : { error: detected.error, drafted };
}

/** Drafts the repo profile from the repository when it is missing. */
export async function draftProfile(project: string): Promise<ActionState> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await draftProfileRun(project);
  revalidatePath(`/projects/${project}/settings`);
  return result.ok
    ? { message: 'Drafted the profile. Review it, then approve it.' }
    : { error: result.error };
}

/** Approves the repo profile draft, so runs and the setup check can use it. */
export async function approveProfile(project: string): Promise<ActionState> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await approveProfileRun(project);
  revalidatePath(`/projects/${project}/settings`);
  return result.ok ? { message: 'Approved the profile.' } : { error: result.error };
}

/** What the feature page says after each command it can send. The backend decides if it is allowed. */
const FEATURE_GATE_MESSAGES: Record<string, string> = {
  grill: 'Sent. The agent reads it now.',
  'skip-grill': 'Skipped the questions.',
  'write-spec': 'Writing the specification.',
  'save-spec': 'Saved. Approve the specification again.',
  'approve-spec': 'Approved.',
  plan: 'Planning started. Refresh to check progress.',
  'save-board': 'Saved the board.',
  'approve-board': 'Approved.',
  'mark-merged': 'Marked as merged.',
  'retry-ticket': 'Started the ticket again.',
  'write-qa': 'Writing the QA plan.',
  complete: 'Completed.',
  cancel: 'Cancelled.',
};

export async function featureGateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  const id = field(form, 'id');
  const action = field(form, 'action');
  const ticket = field(form, 'ticket');
  const text = field(form, 'text');
  let tickets: unknown;
  if (action === 'save-board')
    try {
      tickets = JSON.parse(field(form, 'tickets'));
    } catch {
      return { error: 'The tickets could not be read. Reload the page and try again.' };
    }
  const message = Object.hasOwn(FEATURE_GATE_MESSAGES, action) ? FEATURE_GATE_MESSAGES[action] : undefined;
  if (!isProjectName(project) || !/^[a-z0-9][a-z0-9-]{2,40}$/.test(id) || !message)
    return { error: 'Invalid feature action.' };
  try {
    const { backendCall } = await import('@factory/backend-client');
    await backendCall('FeatureAction', {
      project,
      json: JSON.stringify({
        id,
        action,
        ...(action === 'approve-board' ? { mirror: form.get('mirror') === 'on' } : {}),
        ...((action === 'grill' || action === 'save-spec') && text ? { text } : {}),
        ...(action === 'save-board' ? { tickets } : {}),
        ...(action === 'mark-merged' || action === 'retry-ticket' ? { ticket } : {}),
      }),
    });
    revalidatePath(`/projects/${project}/features/${id}`);
    return { message };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update feature.' };
  }
}

export async function dismissInboxItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = field(form, 'id');
  const project = field(form, 'project');
  if (!id || id.length > 400 || !isProjectName(project)) return { error: 'Invalid inbox item.' };
  try {
    const { backendCall } = await import('@factory/backend-client');
    await backendCall('DismissInboxItem', { project, json: JSON.stringify({ id }) });
    revalidatePath('/', 'layout');
    return { message: 'Dismissed.' };
  } catch {
    return { error: 'Could not dismiss this item. Try again.' };
  }
}

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/;

/** Creates a board task in Backlog or Todo. */
export async function createIssue(
  project: string,
  input: { title: string; description?: string; status: 'backlog' | 'todo' },
): Promise<ActionState & { key?: string }> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  if (!input.title?.trim()) return { error: 'Give the task a title.' };
  const created = await createIssueRun(project, input);
  revalidatePath(`/projects/${project}/tasks`);
  return created.ok
    ? { message: `Created ${created.value.key}.`, key: created.value.key }
    : { error: created.error };
}

/** Applies a board drop; the backend decides whether it sets a status, starts or reruns work, or cancels. */
export async function moveIssue(
  project: string,
  key: string,
  to: string,
): Promise<ActionState & { action?: string }> {
  const status = IssueStatus.safeParse(to);
  if (!isProjectName(project) || !ISSUE_KEY.test(key) || !status.success) return { error: 'Invalid move.' };
  const moved = await moveIssueRun(project, key, status.data);
  revalidatePath(`/projects/${project}/tasks`, 'layout');
  if (!moved.ok) return { error: moved.error };
  const done: Record<string, string> = {
    'start-run': `Started a run for ${key}.`,
    run: `Running ${key} again.`,
    reject: `Cancelled the run for ${key}.`,
  };
  return { action: moved.value.action, message: done[moved.value.action] ?? `Moved ${key}.` };
}

export async function updateIssue(
  project: string,
  key: string,
  patch: {
    title?: string;
    description?: string;
    priority?: string;
    assignee?: string | null;
    start_date?: string | null;
    due_date?: string | null;
  },
): Promise<ActionState> {
  if (!isProjectName(project) || !ISSUE_KEY.test(key)) return { error: 'Invalid task.' };
  const updated = await updateIssueRun(project, { key, ...patch });
  revalidatePath(`/projects/${project}/tasks`, 'layout');
  if (patch.assignee !== undefined) revalidatePath('/projects/[project]/agents', 'layout');
  return updated.ok ? { message: 'Saved.' } : { error: updated.error };
}

export async function commentIssue(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  const key = field(form, 'key');
  const body = field(form, 'body');
  if (!isProjectName(project) || !ISSUE_KEY.test(key)) return { error: 'Invalid task.' };
  const parent = field(form, 'parent') || undefined;
  if (!body.trim()) return { error: parent ? 'Write a reply first.' : 'Write a comment first.' };
  const commented = await commentIssueRun(project, key, body, parent);
  revalidatePath(`/projects/${project}/tasks/${key}`);
  if (!commented.ok) return { error: commented.error };
  return { message: parent ? 'Reply added.' : 'Comment added.' };
}

/** Adds a follow-up on a task whose PR is open. The agent continues the same branch and PR. */
export async function followUpIssue(_prev: ActionState, form: FormData): Promise<ActionState> {
  const project = field(form, 'project');
  const key = field(form, 'key');
  const note = field(form, 'note').trim();
  const kind = field(form, 'kind') === 'conflicts' ? 'conflicts' : 'custom';
  const agent = field(form, 'agent') || undefined;
  if (!isProjectName(project) || !ISSUE_KEY.test(key)) return { error: 'Invalid task.' };
  if (!note) return { error: 'Write what the agent should do.' };
  const followed = await followUpIssueRun(project, key, { note, kind, ...(agent ? { agent } : {}) });
  revalidatePath(`/projects/${project}/tasks/${key}`);
  revalidatePath(`/projects/${project}`);
  if (!followed.ok) return { error: followed.error };
  return { message: 'Follow-up queued. The task moves back through the board as the agent works.' };
}

/** Archives a board task, or restores it with `archived: false`. */
export async function archiveIssue(project: string, key: string, archived: boolean): Promise<ActionState> {
  if (!isProjectName(project) || !ISSUE_KEY.test(key)) return { error: 'Invalid task.' };
  const result = await archiveIssueRun(project, key, archived);
  revalidatePath(`/projects/${project}`, 'layout');
  return result.ok
    ? { message: archived ? `Archived ${key}.` : `Restored ${key}.` }
    : { error: result.error };
}

/** Deletes an archived board task and its runs (worktrees, branches and records). */
export async function deleteIssue(project: string, key: string): Promise<ActionState> {
  if (!isProjectName(project) || !ISSUE_KEY.test(key)) return { error: 'Invalid task.' };
  const result = await deleteIssueRun(project, key);
  revalidatePath(`/projects/${project}`, 'layout');
  if (!result.ok) return { error: result.error };
  return result.value.failed.length
    ? {
        message: `Deleted ${key}. ${result.value.failed.length} run(s) left files behind: ${result.value.failed
          .map((f) => f.error)
          .join('; ')}`,
      }
    : { message: `Deleted ${key} and its runs.` };
}

const USER_SECTIONS = [
  'identity',
  'preferences',
  'tasks',
  'chat',
  'notifications',
  'providers',
  'rules',
] as const;
type UserSection = (typeof USER_SECTIONS)[number];

/** Saves the homepage background the person picked with the arrows; keeps the other preferences. */
export async function saveHomeBackground(background: HomeBackground): Promise<ActionState> {
  if (!HOME_BACKGROUNDS.includes(background)) return { error: 'Unknown background.' };
  const current = await userSettings();
  if (!current.ok) return { error: current.error };
  const saved = await saveUserSettingsRun({
    ...current.value,
    preferences: { ...current.value.preferences, home_background: background },
  });
  revalidatePath('/', 'layout');
  return saved.ok ? { message: 'Saved' } : { error: saved.error };
}

/** Saves one section of the user settings and keeps the rest as stored. */
export async function updateUserSettings<K extends UserSection>(
  section: K,
  value: UserSettings[K],
): Promise<ActionState> {
  if (!USER_SECTIONS.includes(section)) return { error: 'Unknown settings section.' };
  const current = await userSettings();
  if (!current.ok) return { error: current.error };
  const saved = await saveUserSettingsRun({ ...current.value, [section]: value });
  revalidatePath('/', 'layout');
  return saved.ok ? { message: 'Saved' } : { error: saved.error };
}
