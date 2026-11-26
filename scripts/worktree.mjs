#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createServer } from 'node:net';

const help = `Usage: node scripts/worktree.mjs <command>
  new <branch> [base=HEAD] [--install]  Create an isolated sibling checkout
  list                               List Git worktrees
  remove <branch>                     Remove a clean linked checkout; keep branch
  run <web-port> <backend-port> [health-port=backend+1]  Start isolated fullstack
Dependencies use pnpm's shared store; node_modules and secrets are never copied.
`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') {
    console.log(help);
  } else if (command === 'list' && args.length === 0) {
    console.log(git('worktree', 'list'));
  } else if (command === 'new') {
    const install = args.includes('--install');
    const positional = args.filter((arg) => arg !== '--install');
    const [branch, base = 'HEAD'] = positional;
    if (!branch || positional.length > 2 || positional.some((arg) => arg.startsWith('-')))
      throw new Error(help);
    git('check-ref-format', '--branch', branch);
    // Use the common repository location, even when invoked from a linked worktree.
    const common = resolve(git('rev-parse', '--git-common-dir'));
    const main = dirname(common);
    // `/` becomes `-`: an encoded slash (%2F) in a path breaks Node's ESM loader and Vitest.
    // feature/a and feature-a then share a path; the existence check below refuses the second.
    const destination = resolve(
      dirname(main),
      `${basename(main)}--${encodeURIComponent(branch.replaceAll('/', '-'))}`,
    );
    if (existsSync(destination)) throw new Error(`Destination exists: ${destination}`);
    git('rev-parse', '--verify', `${base}^{commit}`);
    git('worktree', 'add', '-b', branch, destination, base);
    console.log(destination);
    if (install) {
      const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
        cwd: destination,
        stdio: 'inherit',
      });
      if (result.status !== 0)
        throw new Error(
          `Install failed; checkout preserved at ${destination}. Retry pnpm install --frozen-lockfile there.`,
        );
      // The web app type-checks against affect-ui's built declarations; without them tsc reports
      // dozens of errors that are not in the change.
      const built = spawnSync('pnpm', ['--filter', '@factory/affect-ui', 'build'], {
        cwd: destination,
        stdio: 'inherit',
      });
      if (built.status !== 0)
        throw new Error(
          `affect-ui build failed in ${destination}. Run pnpm --filter @factory/affect-ui build there.`,
        );
    }
  } else if (command === 'run' && (args.length === 2 || args.length === 3)) {
    const ports = args.map(Number);
    if (ports.length === 2) ports.push(ports[1] + 1);
    if (
      ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
      new Set(ports).size !== 3
    )
      throw new Error('Web, backend, and health ports must be distinct and between 1024 and 65535');
    for (const port of ports) {
      await new Promise((done, fail) => {
        const server = createServer();
        server.once('error', fail);
        server.listen(port, () => server.close(done));
      });
    }
    const root = git('rev-parse', '--show-toplevel');
    const result = spawnSync('pnpm', ['web', '--', '--dev'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: String(ports[0]),
        FACTORY_BACKEND_PORT: String(ports[1]),
        FACTORY_HEALTH_PORT: String(ports[2]),
        FACTORY_BACKEND_ADDRESS: `127.0.0.1:${ports[1]}`,
        FACTORY_ROOT: resolve(root, '.turri', 'worktree-data'),
        FACTORY_REQUIRE_OWN_BACKEND: '1',
      },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else if (command === 'remove' && args.length === 1) {
    const branch = args[0];
    git('check-ref-format', '--branch', branch);
    const records = git('worktree', 'list', '--porcelain', '-z').split('\0\0');
    const record = records.find((entry) => entry.split('\0').includes(`branch refs/heads/${branch}`));
    if (!record) throw new Error(`No checkout for branch ${branch}`);
    const target = record.split('\0')[0].slice('worktree '.length);
    const current = git('rev-parse', '--show-toplevel');
    const main = dirname(resolve(git('rev-parse', '--git-common-dir')));
    if (target === current || target === main)
      throw new Error('Refusing to remove current or primary checkout');
    // Git checks dirty tracked/untracked files; also preserve ignored secrets/builds.
    const dirty = execFileSync('git', ['-C', target, 'status', '--porcelain', '--ignored'], {
      encoding: 'utf8',
    });
    if (dirty)
      throw new Error(
        `Checkout contains local files or changes: ${target}. Inspect and clean it explicitly first.`,
      );
    git('worktree', 'remove', target);
    console.log(`Removed ${target}; branch ${branch} retained.`);
  } else {
    throw new Error(help);
  }
} catch (error) {
  console.error(`worktree: ${error.message}`);
  process.exitCode = 1;
}
