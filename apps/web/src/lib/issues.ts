// Server-only bridge for board tasks ("issues" in code). The backend owns storage, numbering and drops.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend/client';
import { Issue, IssueStatus, Stage } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';

export const IssueView = Issue.extend({
  key: z.string(),
  status: IssueStatus,
  stored_status: IssueStatus,
  run: z.object({ id: z.string(), stage: Stage, updated_at: z.string().optional() }).optional(),
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

type Method = 'GetIssue' | 'CreateIssue' | 'UpdateIssue' | 'MoveIssue' | 'CommentIssue';
async function call(method: Method, project: string, body: object): Promise<unknown> {
  return JSON.parse((await backendCall(method, { project, json: JSON.stringify(body) })).json);
}

export function listIssues(project: string): Promise<Result<IssueList>> {
  return attempt(async () =>
    IssueList.parse(JSON.parse((await backendCall('ListIssues', { project })).json)),
  );
}
/** `key` is a task key (CE-12) or the id of one of its runs. */
export function getIssue(project: string, key: string): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('GetIssue', project, { key })));
}
export function createIssueRun(project: string, input: object): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('CreateIssue', project, input)));
}
export function updateIssueRun(project: string, input: object): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('UpdateIssue', project, input)));
}
export function moveIssueRun(project: string, key: string, to: IssueStatus) {
  return attempt(async () => MoveResult.parse(await call('MoveIssue', project, { key, to })));
}
export function commentIssueRun(project: string, key: string, body: string): Promise<Result<IssueView>> {
  return attempt(async () => IssueView.parse(await call('CommentIssue', project, { key, body })));
}
