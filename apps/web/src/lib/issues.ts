// Server-only bridge for board tasks ("issues" in code). The backend owns storage, numbering and drops.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { Issue, IssueStatus, QueueWait, RemoteLink, Stage } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';
import { cache } from 'react';

export const IssueView = Issue.extend({
  key: z.string(),
  status: IssueStatus,
  stored_status: IssueStatus,
  run: z
    .object({
      id: z.string(),
      stage: Stage,
      updated_at: z.string().optional(),
      waiting: z.boolean().optional(),
      waiting_for: QueueWait.optional(),
      /** A live run holds the task now. Absent from an older backend: the stage decides. */
      owned: z.boolean().optional(),
      /** Why a blocked or failed run waits for a person. Absent from an older backend. */
      reason: z.string().optional(),
    })
    .optional(),
});
export type IssueView = z.infer<typeof IssueView>;
const IssueList = z.object({ prefix: z.string(), items: z.array(IssueView) });
export type IssueList = z.infer<typeof IssueList>;
const MoveResult = z.object({ action: z.string(), issue: IssueView });

async function attempt<T>(call: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof z.ZodError ? 'The backend returned an invalid record.' : backendError(error),
    };
  }
}

type Method =
  | 'GetIssue'
  | 'CreateIssue'
  | 'UpdateIssue'
  | 'MoveIssue'
  | 'CommentIssue'
  | 'FollowUpIssue'
  | 'ArchiveIssue'
  | 'DeleteIssue'
  | 'PromoteTickets';
async function call(method: Method, project: string, body: object): Promise<unknown> {
  return JSON.parse((await backendCall(method, { project, json: JSON.stringify(body) })).json);
}

function listIssuesUncached(project: string): Promise<Result<IssueList>> {
  return attempt(async () =>
    IssueList.parse(JSON.parse((await backendCall('ListIssues', { project })).json)),
  );
}
/** `key` is a task key (CE-12) or the id of one of its runs. */
function getIssueUncached(project: string, key: string): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('GetIssue', project, { key })));
}
export function createIssueRun(project: string, input: object): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('CreateIssue', project, input)));
}
export function updateIssueRun(project: string, input: object): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('UpdateIssue', project, input)));
}
const Promoted = z.object({
  created: z.array(IssueView),
  skipped: z.array(z.object({ key: z.string(), task: z.string() })),
});
/** One Backlog task per remote ticket; tickets another task already links come back as skipped. */
export function promoteTicketsRun(project: string, tickets: RemoteLink[]) {
  return attempt(async () => Promoted.parse(await call('PromoteTickets', project, { tickets })));
}
export function moveIssueRun(project: string, key: string, to: IssueStatus) {
  return attempt(async () => MoveResult.parse(await call('MoveIssue', project, { key, to })));
}
/** Adds a follow-up to a task whose PR is open: an agent continues the same branch and PR. */
export function followUpIssueRun(
  project: string,
  key: string,
  input: { note: string; kind: 'custom' | 'conflicts'; agent?: string },
): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('FollowUpIssue', project, { key, ...input })));
}

export function commentIssueRun(
  project: string,
  key: string,
  body: string,
  parent?: string,
): Promise<Result<IssueView>> {
  return attempt(async () =>
    IssueView.parse(await call('CommentIssue', project, { key, body, ...(parent ? { parent } : {}) })),
  );
}
export function archiveIssueRun(project: string, key: string, archived: boolean): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('ArchiveIssue', project, { key, archived })));
}
const DeleteResult = z.object({
  key: z.string(),
  failed: z.array(z.object({ run: z.string(), error: z.string() })),
});
export function deleteIssueRun(project: string, key: string) {
  return attempt(async () => DeleteResult.parse(await call('DeleteIssue', project, { key })));
}

/** Open and recent board tasks for the project home, newest activity first. */
export async function recentIssues(project: string, limit = 6) {
  const list = await listIssues(project);
  if (!list.ok) return undefined;
  return list.value.items
    .filter((i) => !i.archived_at)
    .map((i) => ({
      key: i.key,
      title: i.title,
      status: i.status,
      updated_at: i.run?.updated_at && i.run.updated_at > i.updated_at ? i.run.updated_at : i.updated_at,
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}

/** Names inbox items by the board task that owns their run, so they read CE-12 and link to it. */
export async function withTaskKeys<T extends { project: string; task_id?: string; title: string }>(
  items: T[],
): Promise<(T & { task_key?: string })[]> {
  const projects = [...new Set(items.filter((i) => i.task_id).map((i) => i.project))];
  const owners = new Map<string, { key: string; title: string }>();
  await Promise.all(
    projects.map(async (project) => {
      const list = await listIssues(project);
      if (!list.ok) return;
      for (const issue of list.value.items)
        for (const run of issue.runs) owners.set(`${project}/${run}`, { key: issue.key, title: issue.title });
    }),
  );
  return items.map((item) => {
    const owner = item.task_id ? owners.get(`${item.project}/${item.task_id}`) : undefined;
    return owner ? { ...item, task_key: owner.key, title: owner.title } : item;
  });
}

// One read per server render: the page, its layouts and generateMetadata share the result.
// Outside a render (server actions, route handlers) `cache` calls straight through.
export const listIssues = cache(listIssuesUncached);
export const getIssue = cache(getIssueUncached);
