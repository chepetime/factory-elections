// Publication: push the approved commit and open its PR. Intent is saved before each GitHub write,
// and GitHub is read before any new one, so a lost or ambiguous write is never repeated.
import { openPrBlockers, prBody, prTitle, withStage, type TaskRecord } from '@factory/core';
import { DriverError, type DriverDeps } from './ports.ts';
import { readPrTemplate } from './support.ts';
import { checkedWorktree } from './worktree.ts';

export async function openPr(
  deps: DriverDeps,
  project: string,
  id: string,
  options: { draft?: boolean } = {},
): Promise<TaskRecord> {
  let task = await deps.tasks.read(project, id);
  const { path, branch, base } = await checkedWorktree(deps, task);
  const head = await deps.git.headSha(path);
  const blockers = openPrBlockers(task, head);
  if (blockers.length) throw new DriverError(`cannot open a pull request: ${blockers.join('; ')}`);
  if (!(await deps.git.isClean(path))) throw new DriverError('the task worktree has uncommitted changes');
  if (!(await deps.git.remoteUrl(path))) throw new DriverError('the repository has no "origin" remote');
  // A stacked PR targets its blocker's branch, which GitHub must already have.
  if (task.stack_on && base === task.stack_on && !(await deps.git.remoteBranchExists?.(path, base)))
    throw new DriverError(`open the pull request of the blocking ticket first: ${base} is not on origin yet`);
  // Intent first: a crash after a GitHub write leaves this record, and the next attempt
  // reconciles with GitHub instead of writing again.
  const intent = async (step: 'push' | 'create') => {
    const current = await deps.tasks.read(project, id);
    const previous = current.publication?.head_sha === head ? current.publication : undefined;
    const publication = {
      op_id: previous?.op_id ?? `pub-${head.slice(0, 12)}-${Date.parse(deps.now()).toString(36)}`,
      head_sha: head,
      branch,
      base,
      step,
      at: deps.now(),
    };
    await deps.tasks.write({ ...current, publication });
  };
  await intent('push');
  deps.log(`Pushing ${branch}…`);
  await deps.git.push(path, branch);
  await intent('create');
  // A previous attempt may have opened the PR and then failed to record it. Adopt an open PR for
  // this commit; a closed or merged one needs a person, because opening another repeats a write.
  const fromBranch = await deps.github.pullRequestsFrom({ cwd: path, head: branch });
  // After a follow-up the push updated the task's own PR: adopt it, whatever head GitHub lists yet.
  const own = task.pr ? fromBranch.find((pr) => pr.url === task.pr!.url) : undefined;
  if (own && own.state !== 'OPEN')
    throw new DriverError(
      `the task's pull request is ${own.state.toLowerCase()}: ${own.url}. ` +
        'Reopen it on GitHub and open the PR again, or reject the task',
    );
  const same = fromBranch.filter((pr) => pr.head_sha === head);
  const open = own ?? same.find((pr) => pr.state === 'OPEN');
  const ended = same.find((pr) => pr.state !== 'OPEN');
  if (!open && ended)
    throw new DriverError(
      `a pull request for this commit already exists and is ${ended.state.toLowerCase()}: ${ended.url}. ` +
        'Reopen it on GitHub and open the PR again to adopt it, or reject the task',
    );
  if (own) deps.log(`Updated the pull request: ${own.url}`);
  else if (open) deps.log(`Pull request already open: ${open.url}`);
  else deps.log('Opening pull request…');
  const url =
    open?.url ??
    (await deps.github.createPullRequest({
      cwd: path,
      base,
      head: branch,
      title: prTitle(task, head),
      body: prBody(task, head, (await readPrTemplate(path)).text),
      draft: options.draft,
    }));
  task = await deps.tasks.read(project, id);
  const { publication: _done, ...recorded } = task;
  task = recorded;
  task = withStage(
    { ...task, pr: { url, branch, head_sha: head, at: deps.now() } },
    deps.now(),
    'pr-opened',
    url,
  );
  await deps.tasks.write(task);
  return task;
}
