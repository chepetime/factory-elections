// Opens pull requests through the GitHub CLI, using the machine's own `gh auth login`.
import { run } from '@factory/adapters-process';

export class GitHubError extends Error {}

export async function ghAvailable(): Promise<boolean> {
  return (await run('gh', ['auth', 'status'])).code === 0;
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
