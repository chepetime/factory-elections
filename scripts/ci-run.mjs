import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { changedFiles, planChanges } from './ci-plan.mjs';

// Usage: node scripts/ci-run.mjs <base|--all> [head] [--part=node|web-check|web-build]
// Without --part every part runs in order. PR CI runs each part in its own parallel job.
const PARTS = ['node', 'web-check', 'web-build'];
const partArg = process.argv.find((arg) => arg.startsWith('--part='));
const part = partArg?.slice('--part='.length);
if (part !== undefined && !PARTS.includes(part)) {
  console.error(`Unknown --part=${part}; use one of ${PARTS.join(', ')}`);
  process.exit(2);
}
const positional = process.argv.slice(2).filter((arg) => arg !== partArg);
const runs = (name) => part === undefined || part === name;
// Tool caches (prettier, tsc build info) only skip unchanged inputs; CI restores this folder.
const CACHE = 'node_modules/.cache/factory-ci';

const plan = planChanges(changedFiles(positional[0], positional[1] || 'HEAD'));
console.log(`Affected: ${plan.packages.join(', ') || 'documentation only'}`);
function run(command, args) {
  // The post-commit runner reads the last `==> ` line of this output as the failed step.
  console.log(`==> ${[command === process.execPath ? 'node' : command, ...args].join(' ').slice(0, 120)}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (runs('node')) {
  // Repository rules only read files, so they run on every plan, also a docs-only one.
  run(process.execPath, ['--test', '--test-reporter=dot', ...globSync('tests/repo/**/*.test.ts')]);
  if (plan.code) {
    run('pnpm', [
      'format:check',
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      `${CACHE}/prettier`,
    ]);
    run('pnpm', ['lint']);
    // Root TypeScript is a single program; keep its cross-package contract check.
    run('pnpm', [
      'exec',
      'tsc',
      '--noEmit',
      '--pretty',
      'false',
      '--incremental',
      '--tsBuildInfoFile',
      `${CACHE}/root.tsbuildinfo`,
    ]);
    const tests = plan.packages
      .filter((path) => path !== 'apps/web')
      .flatMap((path) => globSync(`${path}/test/**/*.test.ts`));
    if (tests.length) run(process.execPath, ['--test', '--test-reporter=dot', ...tests]);
    if (plan.full) {
      const harness = globSync('scripts/*.test.mjs');
      if (harness.length) run(process.execPath, ['--test', ...harness]);
    }
  }
}
if (plan.web && (runs('web-check') || runs('web-build'))) {
  // Each @factory/web script builds affect-ui first. Build it once here, then call the same tools
  // as the web typecheck, test and build scripts directly. Keep these in step with apps/web/package.json.
  run('pnpm', ['--filter', '@factory/affect-ui', 'build']);
  const web = (...args) => run('pnpm', ['--filter', '@factory/web', 'exec', ...args]);
  if (runs('web-check')) {
    web('tsc', '--noEmit', '--pretty', 'false');
    web('vitest', 'run', '--project', 'unit');
  }
  // Route structure and server/client boundaries fail only in a production build.
  if (runs('web-build')) web('next', 'build', '--webpack');
}
