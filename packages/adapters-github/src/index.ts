// Opens pull requests through the GitHub CLI, using the machine's own `gh auth login`.
import { run } from '@factory/adapters-process';

export class GitHubError extends Error {}

export async function ghAvailable(): Promise<boolean> {
  return (await run('gh', ['auth', 'status'])).code === 0;
}

/** The URL of the open pull request from branch `head`, if there is one. */
export async function findOpenPullRequest(options: {
  cwd: string;
  head: string;
}): Promise<string | undefined> {
  const result = await run(
    'gh',
    ['pr', 'list', '--head', options.head, '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""'],
    { cwd: options.cwd },
  );
  if (result.code !== 0)
    throw new GitHubError(`gh pr list failed: ${(result.stderr || result.stdout).trim()}`);
  const url = result.stdout.trim();
  return url.startsWith('https://') ? url : undefined;
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
