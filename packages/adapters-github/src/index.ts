// Opens pull requests through the GitHub CLI, using the machine's own `gh auth login`.
import { run } from '@factory/adapters-process';

export class GitHubError extends Error {}

export async function ghAvailable(): Promise<boolean> {
  return (await run('gh', ['auth', 'status'])).code === 0;
}

export interface BranchPullRequest {
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  /** The commit the pull request's head pointed at last. */
  head_sha: string;
}

/** The pull requests from branch `head` in any state, newest first. */
export async function pullRequestsFrom(options: { cwd: string; head: string }): Promise<BranchPullRequest[]> {
  const result = await run(
    'gh',
    [
      'pr',
      'list',
      '--head',
      options.head,
      '--state',
      'all',
      '--limit',
      '20',
      '--json',
      'url,state,headRefOid',
    ],
    { cwd: options.cwd },
  );
  if (result.code !== 0)
    throw new GitHubError(`gh pr list failed: ${(result.stderr || result.stdout).trim()}`);
  const rows = JSON.parse(result.stdout || '[]') as { url: string; state: string; headRefOid: string }[];
  return rows
    .filter((r) => r.url.startsWith('https://') && ['OPEN', 'CLOSED', 'MERGED'].includes(r.state))
    .map((r) => ({ url: r.url, state: r.state as BranchPullRequest['state'], head_sha: r.headRefOid }));
}

export async function createPullRequest(options: {
  cwd: string;
  base: string;
  head: string;
  title: string;
  body: string;
  draft?: boolean;
}): Promise<string> {
  const args = [
    'pr',
    'create',
    '--base',
    options.base,
    '--head',
    options.head,
    '--title',
    options.title,
    '--body-file',
    '-',
  ];
  if (options.draft) args.push('--draft');
  const result = await run('gh', args, { cwd: options.cwd, input: options.body });
  if (result.code !== 0)
    throw new GitHubError(`gh pr create failed: ${(result.stderr || result.stdout).trim()}`);
  const url = result.stdout
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('https://'));
  if (!url) throw new GitHubError(`gh pr create did not print a pull request URL: ${result.stdout.trim()}`);
  return url;
}

// GraphQL instead of `gh pr list`: the latter returns empty review commit oids and exceeds GitHub
// node limits when asked for reviews, comments and commits together.
const OPEN_PULL_REQUESTS = `query($owner: String!, $name: String!, $me: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number headRefName title url body isDraft createdAt reviewDecision headRefOid
        additions deletions changedFiles
        author { login }
        assignees(first: 10) { nodes { login } }
        reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
        myReviews: reviews(last: 1, author: $me, states: [COMMENTED, CHANGES_REQUESTED, APPROVED, DISMISSED]) {
          nodes { state submittedAt commit { oid } }
        }
        comments(last: 50) { nodes { author { login } createdAt } }
        commits(last: 1) { nodes { commit { committedDate } } }
      }
    }
  }
}`;

async function gh(cwd: string | undefined, args: string[], what: string): Promise<string> {
  const result = await run('gh', args, { cwd, timeoutMs: 60_000 });
  if (result.code !== 0) throw new GitHubError(`${what} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

/** The login of the machine's signed-in GitHub account. */
export async function githubLogin(): Promise<string> {
  const login = (await gh(undefined, ['api', 'user', '--jq', '.login'], 'gh api user')).trim();
  if (!login) throw new GitHubError('gh api user returned no login');
  return login;
}

/** Raw open-PR nodes for the repository at `cwd`, newest first. `me` scopes the review fields. */
export async function openPullRequestNodes(cwd: string, me: string): Promise<unknown[]> {
  const out = await gh(
    cwd,
    [
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-f',
      `me=${me}`,
      '-f',
      `query=${OPEN_PULL_REQUESTS}`,
    ],
    'gh api graphql',
  );
  const nodes = (JSON.parse(out) as { data?: { repository?: { pullRequests?: { nodes?: unknown } } } }).data
    ?.repository?.pullRequests?.nodes;
  if (!Array.isArray(nodes)) throw new GitHubError('gh api graphql returned no pull requests');
  return nodes;
}

/** The head branch, URL and title of PR `number` in the repository at `cwd`. */
export async function pullRequestHead(
  cwd: string,
  number: number,
): Promise<{ branch: string; url: string; title: string }> {
  const out = await gh(cwd, ['pr', 'view', String(number), '--json', 'headRefName,url,title'], 'gh pr view');
  const { headRefName, url, title } = JSON.parse(out) as {
    headRefName?: string;
    url?: string;
    title?: string;
  };
  if (!headRefName) throw new GitHubError(`PR #${number} has no head branch`);
  return { branch: headRefName, url: url ?? '', title: title ?? '' };
}

/** Takes a draft pull request out of draft, so people are asked to review it. */
export async function markPullRequestReady(cwd: string, number: number): Promise<void> {
  const result = await run('gh', ['pr', 'ready', String(number)], { cwd });
  if (result.code !== 0)
    throw new GitHubError(`gh pr ready failed: ${(result.stderr || result.stdout).trim()}`);
}

/** Replaces a pull request's description. */
export async function editPullRequestBody(cwd: string, number: number, body: string): Promise<void> {
  const result = await run('gh', ['pr', 'edit', String(number), '--body-file', '-'], { cwd, input: body });
  if (result.code !== 0)
    throw new GitHubError(`gh pr edit failed: ${(result.stderr || result.stdout).trim()}`);
}

/** Whether the pull request is a draft. */
export async function pullRequestIsDraft(cwd: string, number: number): Promise<boolean> {
  const result = await run('gh', ['pr', 'view', String(number), '--json', 'isDraft', '--jq', '.isDraft'], {
    cwd,
  });
  if (result.code !== 0)
    throw new GitHubError(`gh pr view failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim() === 'true';
}

/** What the backend read from GitHub for one pull request: files to hand to a sandboxed review turn. */
export interface PullRequestContext {
  /** File name -> content, for each part that was fetched. */
  files: Record<string, string>;
  /** One line per part that could not be fetched: the file it would have been, and why. */
  failures: string[];
}

const PR_FIELDS = [
  'number,title,body,url,state,isDraft,mergedAt,closedAt,author,baseRefName,headRefName,headRefOid',
  'additions,deletions,changedFiles,files,labels,reviewDecision,commits,comments,reviews',
].join(',');

const REVIEW_THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved isOutdated path line startLine
          comments(first: 50) { nodes { author { login } body createdAt url } }
        }
      }
    }
  }
}`;

/**
 * The pull request's data as files: `pr.json` (title, body, state, commits, comments and reviews),
 * `pr.diff`, `threads.json` (review threads) and `checks.txt` (CI status). Each part is fetched on
 * its own, so one failure leaves the others; failures are listed, never thrown. A review turn runs
 * in a sandbox with no network or GitHub token, so the backend reads GitHub for it.
 */
export async function pullRequestContext(cwd: string, number: number): Promise<PullRequestContext> {
  const n = String(number);
  const parts: [string, () => Promise<string>][] = [
    ['pr.json', () => gh(cwd, ['pr', 'view', n, '--json', PR_FIELDS], 'gh pr view')],
    ['pr.diff', () => gh(cwd, ['pr', 'diff', n], 'gh pr diff')],
    [
      'threads.json',
      () =>
        gh(
          cwd,
          [
            'api',
            'graphql',
            '-F',
            'owner={owner}',
            '-F',
            'name={repo}',
            '-F',
            `number=${n}`,
            '-f',
            `query=${REVIEW_THREADS}`,
          ],
          'gh api graphql',
        ),
    ],
    // `gh pr checks` exits non-zero while checks fail or are pending, and still prints the table.
    [
      'checks.txt',
      async () => {
        const result = await run('gh', ['pr', 'checks', n], { cwd, timeoutMs: 60_000 });
        if (result.stdout.trim()) return result.stdout;
        throw new GitHubError(`gh pr checks failed: ${(result.stderr || 'no output').trim()}`);
      },
    ],
  ];
  const settled = await Promise.allSettled(parts.map(([, fetch]) => fetch()));
  const context: PullRequestContext = { files: {}, failures: [] };
  settled.forEach((outcome, i) => {
    const name = parts[i]![0];
    if (outcome.status === 'fulfilled') context.files[name] = outcome.value;
    else context.failures.push(`${name}: ${(outcome.reason as Error).message.split('\n')[0]}`);
  });
  return context;
}
