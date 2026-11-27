// Verification: the profile's checks in the task worktree, and the profile check before any task.
import { homedir } from 'node:os';
import {
  checkRun,
  environmentFailure,
  tooBroadForLocalCheck,
  isTestPath,
  testWeakening,
  isGeneratedPath,
  runtimeVerdict,
  type RuntimeVerdict,
} from '@factory/core';
import { DriverError, type DriverDeps } from './ports.ts';
import {
  tail,
  MINUTE,
  type ProfileCheckStep,
  type ProfileCheckResult,
  checkLimits,
  freePort,
} from './support.ts';
import { checkedWorktree } from './worktree.ts';

/** Runs the profile's test and full-check commands in the worktree. Does not change the task file. */
export async function verifyWorktree(
  deps: DriverDeps,
  project: string,
  id: string,
): Promise<{
  passed: boolean;
  output: string;
  headSha: string;
  runtime?: RuntimeVerdict;
  notRunLocally?: string[];
  testIntegrity?: 'checked' | 'allowed';
}> {
  const task = await deps.tasks.read(project, id);
  const profile = await deps.readProfile(project);
  const { path, base } = await checkedWorktree(deps, task);
  const startingHead = await deps.git.headSha(path);
  const changes = await deps.git.diffLineCounts(path, base);
  const nonTestLines = changes
    .filter((change) => !isTestPath(change.path))
    .reduce((sum, change) => sum + (change.added ?? 0) + (change.deleted ?? 0), 0);
  if (nonTestLines > 400)
    return {
      passed: false,
      output: `[change has ${nonTestLines} non-test lines; limit is 400. Split the task into smaller deployable changes.]`,
      headSha: startingHead,
    };
  // Passing tests prove nothing if the change made them easier to pass.
  const weakened =
    task.allow_test_changes === true ? [] : testWeakening(await deps.git.diffSince(path, base));
  if (weakened.length)
    return {
      passed: false,
      output: `[the change weakens tests: ${weakened.join('; ')}. Keep the tests and fix the code. A person can allow test changes for this task.]`,
      headSha: startingHead,
    };
  const limits = checkLimits(profile);
  let output = '';
  let commandOutput = '';
  const onOutput = (chunk: string) => {
    output = tail(output + chunk);
    commandOutput = tail(commandOutput + chunk);
    deps.log(chunk.replace(/\n$/, ''));
  };
  const notRunLocally: string[] = [];
  for (const [label, command] of [
    ['test', profile.commands.test],
    ['full_check', profile.commands.full_check],
  ] as const) {
    deps.log(`$ ${command}   # ${label}`);
    commandOutput = '';
    const result = await deps.shell.runShell(command, {
      cwd: path,
      ...checkRun({ sandbox: profile.sandbox, cwd: path, home: homedir() }),
      captureLimit: 0,
      onOutput,
      timeoutMs: limits.timeoutMs,
      stallMs: limits.stallMs,
      signal: deps.signal,
      group: true,
    });
    if (result.stopped === 'aborted')
      throw new DriverError(`${label} was stopped because the run was cancelled`);
    if (result.stopped) {
      output += `\n[${label} ${limits.why(result.stopped)} and was stopped]\n`;
      return { passed: false, output: tail(output), headSha: await deps.git.headSha(path) };
    }
    const tooBroad = result.code !== 0 ? tooBroadForLocalCheck(commandOutput) : undefined;
    if (tooBroad) {
      // The repository refuses to run this check on a workstation. CI runs it on the pull request.
      output += `\n[${label} not run locally: ${tooBroad} CI must pass before merge.]\n`;
      notRunLocally.push(label);
      continue;
    }
    if (result.code !== 0) {
      output += `\n[${label} exited with status ${result.code}]\n`;
      return { passed: false, output: tail(output), headSha: await deps.git.headSha(path) };
    }
  }
  let runtime: RuntimeVerdict | undefined;
  if (profile.commands.runtime_check) {
    const command = profile.commands.runtime_check;
    // Reticle keeps session journals in .reticle/; they must not make the tree dirty.
    await deps.git.excludeLocally?.(path, '.reticle/');
    deps.log(`$ ${command}   # runtime_check`);
    let checkOutput = '';
    const result = await deps.shell.runShell(command, {
      cwd: path,
      // Its own port, so parallel tasks' dev servers do not collide; no usage telemetry. The
      // sandbox allows the loopback, so the dev server and the browser it drives can talk.
      ...checkRun({
        sandbox: profile.sandbox,
        cwd: path,
        home: homedir(),
        extraEnv: { PORT: String(await freePort()), DO_NOT_TRACK: '1', RETICLE_FEEDBACK: '0' },
      }),
      captureLimit: 0,
      onOutput: (chunk) => {
        checkOutput = tail(checkOutput + chunk);
        onOutput(chunk);
      },
      timeoutMs: limits.timeoutMs,
      stallMs: limits.stallMs,
      signal: deps.signal,
      group: true,
    });
    if (result.stopped === 'aborted')
      throw new DriverError('runtime_check was stopped because the run was cancelled');
    if (result.stopped) {
      output += `\n[runtime_check ${limits.why(result.stopped)} and was stopped]\n`;
      return {
        passed: false,
        output: tail(output),
        headSha: await deps.git.headSha(path),
        runtime: 'none',
      };
    }
    runtime = runtimeVerdict(checkOutput);
    if (runtime === 'no') {
      output += '\n[runtime_check found faults in the running app; fix each ✗ line above]\n';
      return { passed: false, output: tail(output), headSha: await deps.git.headSha(path), runtime };
    }
    // Only `yes` is a pass. Anything else cannot fail the coder, but the gate shows it to the human.
    if (runtime !== 'yes')
      output += `\n[runtime_check could not decide (verdict: ${runtime}, exit ${result.code}); check the running app before approving]\n`;
  }
  // Verification must not change the reviewed change: generated files that are not ignored
  // would otherwise be missing from the commit, or block opening the pull request.
  const dirty = await deps.git.dirtyFiles(path);
  if (dirty.length) {
    output += `\n[verification left uncommitted changes: ${dirty.join(', ')}. Commit them or add them to .gitignore.]\n`;
    return { passed: false, output: tail(output), headSha: await deps.git.headSha(path) };
  }
  // Build output and caches do not belong in the change, even when the repository forgot to
  // ignore them (a committed tsconfig.tsbuildinfo once slipped through review this way).
  const generated = (await deps.git.addedOrModifiedSince(path, base)).filter((file) =>
    isGeneratedPath(file, profile.generated_paths),
  );
  if (generated.length) {
    output += `\n[the change commits generated files: ${generated.join(', ')}. Remove them from the change and add them to .gitignore.]\n`;
    return { passed: false, output: tail(output), headSha: await deps.git.headSha(path) };
  }
  const headSha = await deps.git.headSha(path);
  if (headSha !== startingHead) {
    output += '\n[the commit changed during verification; rerun checks against one unchanged commit.]\n';
    return { passed: false, output: tail(output), headSha };
  }
  return {
    passed: true,
    output,
    headSha,
    testIntegrity: task.allow_test_changes === true ? 'allowed' : 'checked',
    ...(runtime ? { runtime } : {}),
    ...(notRunLocally.length ? { notRunLocally } : {}),
  };
}

/**
 * Checks the profile before any paid run: preflight checks, then setup, test and full_check in
 * a temporary worktree from the base branch. No model is called. The first failure skips the
 * remaining steps; the worktree is always removed.
 */
export async function checkProfile(
  deps: DriverDeps,
  project: string,
  repo: string,
): Promise<ProfileCheckResult> {
  const profile = await deps.readProfile(project);
  const limits = checkLimits(profile);
  const steps: ProfileCheckStep[] = [];
  let failed = false;
  const step = async (name: string, command: string, cwd: string, timeoutMs: number, stallMs?: number) => {
    if (failed) {
      steps.push({ name, command, outcome: 'skipped', duration_ms: 0, output: '' });
      return;
    }
    const started = Date.now();
    let output = '';
    deps.log(`$ ${command}   # ${name}`);
    const result = await deps.shell.runShell(command, {
      cwd,
      captureLimit: 0,
      onOutput: (chunk) => {
        output = tail(output + chunk, 4000);
        deps.log(chunk.replace(/\n$/, ''));
      },
      timeoutMs,
      ...(stallMs ? { stallMs } : {}),
      signal: deps.signal,
      group: true,
    });
    if (result.stopped === 'aborted') throw new DriverError('the profile check was stopped');
    const ok = !result.stopped && result.code === 0;
    if (!ok)
      output += `\n[${result.stopped ? `${limits.why(result.stopped)} and was stopped` : `exited with status ${result.code}`}]`;
    const environment = ok ? undefined : environmentFailure(output, profile.environment_errors);
    steps.push({
      name,
      command,
      outcome: ok ? 'passed' : 'failed',
      duration_ms: Date.now() - started,
      output: output.trim(),
      ...(environment ? { environment: environment.reason } : {}),
    });
    if (!ok) failed = true;
  };
  for (const check of profile.preflight ?? [])
    await step(`Preflight: ${check.name}`, check.run, repo, 2 * MINUTE);
  const base = profile.repo.base_branch.value;
  const stamp = `profile-check-${Date.now()}`;
  const path = deps.tasks.worktreePath(project, stamp);
  const branch = `factory/${stamp}`;
  let created = false;
  if (failed) steps.push({ name: `Worktree from ${base}`, outcome: 'skipped', duration_ms: 0, output: '' });
  else {
    const started = Date.now();
    try {
      await deps.git.addWorktree(repo, path, branch, base);
      created = true;
      steps.push({
        name: `Worktree from ${base}`,
        outcome: 'passed',
        duration_ms: Date.now() - started,
        output: path,
      });
    } catch (error) {
      failed = true;
      steps.push({
        name: `Worktree from ${base}`,
        outcome: 'failed',
        duration_ms: Date.now() - started,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    if (profile.commands.setup)
      await step('Setup', profile.commands.setup, path, limits.timeoutMs, limits.stallMs);
    await step('Test', profile.commands.test, path, limits.timeoutMs, limits.stallMs);
    await step('Full check', profile.commands.full_check, path, limits.timeoutMs, limits.stallMs);
  } finally {
    if (created) await deps.git.removeWorktree(repo, path, branch).catch(() => undefined);
  }
  return { passed: !failed, steps };
}
