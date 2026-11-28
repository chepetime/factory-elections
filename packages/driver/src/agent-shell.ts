import { homedir } from 'node:os';
import {
  checkRun,
  DEFAULT_STEP_LIMITS,
  parseModelRef,
  type FactoryTool,
  type ModelRun,
  type RepoProfile,
  type TaskRecord,
  type ToolGuard,
} from '@factory/core';
import { z } from 'zod';
import { DriverError, type AgentSession, type ShellPort } from './ports.ts';
import { changeCheckTool } from './agent-fixes.ts';
import { changeGate } from './verification.ts';
import type { Driver } from './workflow.ts';

const Input = z.object({ command: z.string().trim().min(1).max(40_000) });

export function agentShell(
  shell: ShellPort,
  cwd: string,
  guard: ToolGuard,
  sandbox: ModelRun['sandbox'],
  env: Record<string, string> | undefined,
  passEnv: string[],
  signal: AbortSignal,
): { tool: FactoryTool; drained(): Promise<unknown> } {
  const home = homedir();
  const policy = checkRun({ home, cwd, sandbox: { ...sandbox, pass_env: passEnv }, extraEnv: env });
  policy.sandbox.denyRead.push(`${home}/.codex`, `${home}/.pi`, `${home}/.claude`);
  for (const path of [
    process.env.CODEX_HOME,
    process.env.FACTORY_CODEX_HOME,
    process.env.PI_CODING_AGENT_DIR,
  ])
    if (path) policy.sandbox.denyRead.push(path);
  const running = new Set<Promise<unknown>>();
  const tool: FactoryTool = {
    name: 'shell',
    description:
      'Run a command to read, edit or test the task worktree. Commands start in the worktree. Factory commits changes after the turn. Do not start background processes.',
    inputSchema: z.toJSONSchema(Input),
    async call(raw) {
      const { command } = Input.parse(raw);
      const denied = guard.check('Bash', { command });
      if (denied) return { text: denied, isError: true };
      if (signal.aborted) return { text: 'The task turn has stopped.', isError: true };
      const work = shell.runShell(command, {
        ...policy,
        cwd,
        signal,
        group: true,
        timeoutMs: 120_000,
        captureLimit: 24_000,
      });
      running.add(work);
      const result = await work.finally(() => running.delete(work));
      return {
        text: [result.stdout, result.stderr, result.stopped ?? `Exit status ${result.code}`]
          .filter(Boolean)
          .join('\n'),
        isError: result.code !== 0 || !!result.stopped,
      };
    },
  };
  return { tool, drained: () => Promise.allSettled(running) };
}

export function prepareAgentTools(
  d: Driver,
  task: TaskRecord,
  profile: RepoProfile,
  session: AgentSession,
  path: string,
  compare: string,
  budget: number,
  env: Record<string, string> | undefined,
) {
  const sandbox = {
    allowed_domains: profile.sandbox?.allowed_domains,
    allow_write: profile.sandbox?.allow_write,
  };
  const guard = d.coderGuard(path, profile, task);
  const brokered = parseModelRef(session.model).provider !== 'claude';
  const turn = new AbortController();
  const passEnv = [...(profile.sandbox?.pass_env ?? []), ...session.passEnv];
  const signal = d.deps.signal;
  const shellSignal = signal ? AbortSignal.any([signal, turn.signal]) : turn.signal;
  const shell = brokered
    ? agentShell(d.deps.shell, path, guard, sandbox, env, passEnv, shellSignal)
    : undefined;
  const grant = d.deps.delegation?.grant({
    label: `agent ${task.project}/${task.id}`,
    cwd: path,
    access: 'edit',
    sandbox,
    budgetUsd: Math.min(budget, DEFAULT_STEP_LIMITS.budget_usd),
    guard,
    runner: d.deps.runner,
    tools: [
      ...session.tools,
      ...(shell ? [shell.tool] : []),
      changeCheckTool(async () => {
        const current = await d.deps.tasks.read(task.project, task.id);
        return changeGate(d.deps, path, compare, current.allow_test_changes === true);
      }),
    ],
    ...(signal ? { signal } : {}),
  });
  return {
    request(): Pick<ModelRun, 'sandbox' | 'env' | 'passEnv' | 'tools' | 'guard' | 'mcp'> {
      if (brokered && !grant) throw new DriverError('Factory could not start its guarded worktree tools.');
      return {
        sandbox,
        env,
        passEnv,
        tools: brokered ? 'none' : 'edit',
        guard: brokered ? undefined : guard,
        mcp: grant?.endpoint,
      };
    },
    instructions: brokered
      ? `${session.systemPrompt}\n\nUse the Factory shell tool to read, edit and test files in the task worktree.`
      : session.systemPrompt,
    async close() {
      turn.abort();
      grant?.revoke();
      await shell?.drained();
    },
    spent: () => grant?.spent() ?? 0,
  };
}
