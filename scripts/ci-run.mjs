import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { changedFiles, planChanges } from './ci-plan.mjs';

const plan = planChanges(changedFiles(process.argv[2], process.argv[3] || 'HEAD'));
console.log(`Affected: ${plan.packages.join(', ') || 'documentation only'}`);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (plan.code) {
  run('pnpm', ['format:check']);
  run('pnpm', ['lint']);
  // Root TypeScript is a single program; keep its cross-package contract check.
  run('pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false']);
  const tests = plan.packages
    .filter((path) => path !== 'apps/web')
    .flatMap((path) => globSync(`${path}/test/**/*.test.ts`));
  if (tests.length) run(process.execPath, ['--test', '--test-reporter=dot', ...tests]);
  if (plan.full) {
    const harness = globSync('scripts/*.test.mjs');
    if (harness.length) run(process.execPath, ['--test', ...harness]);
  }
  if (plan.web) {
    run('pnpm', ['--filter', '@factory/web', 'typecheck']);
    run('pnpm', ['--filter', '@factory/web', 'test']);
  }
}
