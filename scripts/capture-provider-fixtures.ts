// Phase 0 baseline: runs each provider entry point for real, saves sanitized protocol fixtures and
// records lifecycle evidence (resume, cancel during a shell tool, descendant cleanup).
//
//   node scripts/capture-provider-fixtures.ts [claude-sdk|claude-cli|codex ...]
//
// It calls paid models (a few cents: Haiku for Claude, low effort for Codex). It is opt-in and
// never runs in CI. Fixtures go beside each adapter's tests; the summary prints as JSON.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentRunner, claudeCli } from '../packages/adapters-claude/src/index.ts';
import { CodexRunner, execArgs } from '../packages/adapters-codex/src/index.ts';
import { spawnDetached, stopGroup, isAlive } from '../packages/adapters-process/src/index.ts';
import { TESTED_RUNTIMES } from '../packages/core/src/agents.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_FIXTURES = join(ROOT, 'packages/adapters-claude/test/fixtures');
const CODEX_FIXTURES = join(ROOT, 'packages/adapters-codex/test/fixtures');
const CLAUDE_MODEL = 'claude-haiku-5-5';
const TOOL_PROMPT =
  'Run exactly this shell command with your Bash tool: echo fixture-ok\nThen reply with one word: done';
const RESUME_PROMPT = 'Reply with one word: again';
const sleepPrompt = (marker: string) =>
  `Run exactly this shell command with your Bash tool and wait for it: sleep ${marker}\nThen reply: done`;

/** Replaces machine paths, ids and addresses with stable placeholders, so fixtures can be committed. */
function sanitizer(dir: string) {
  const ids = new Map<string, string>();
  const id = (value: string, kind: string) => {
    if (!ids.has(value)) ids.set(value, `${kind}-${ids.size + 1}`);
    return ids.get(value)!;
  };
  return (line: string): string =>
    line
      .replaceAll(`/private${dir}`, '<workdir>')
      .replaceAll(dir, '<workdir>')
      .replaceAll(homedir(), '<home>')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (m) => id(m, 'uuid'))
      .replace(/\b(toolu|msg|req)_[A-Za-z0-9]+/g, (m, kind: string) => id(m, kind));
}

/** Whether a process whose command line contains `marker` still runs; kills any it finds. */
function survivors(marker: string): number {
  let pids: number[] = [];
  try {
    pids = execFileSync('pgrep', ['-f', `sleep ${marker}`], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return 0;
  }
  for (const pid of pids)
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  return pids.length;
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'factory-fixture-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function save(dir: string, name: string, lines: string[], clean: (l: string) => string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), lines.map(clean).join('\n') + '\n');
}

/** SDK tasks: the coder path. Raw SDK messages are teed through the runner's query option. */
async function claudeSdk() {
  return withDir(async (dir) => {
    const clean = sanitizer(dir);
    let raw: string[] = [];
    const tee = ((args: Parameters<typeof query>[0]) => {
      const inner = query(args);
      return (async function* () {
        for await (const m of inner) {
          raw.push(JSON.stringify(m));
          yield m;
        }
      })();
    }) as unknown as typeof query;
    const runner = new ClaudeAgentRunner({ query: tee });
    const base = {
      model: CLAUDE_MODEL,
      effort: 'low' as const,
      systemPrompt: '',
      tools: 'edit' as const,
      cwd: dir,
    };

    const first = await runner.run({
      ...base,
      prompt: TOOL_PROMPT,
      persistSession: true,
      timeoutMs: 120_000,
    });
    await save(CLAUDE_FIXTURES, 'sdk-tool-turn.jsonl', raw, clean);
    raw = [];
    const second = await runner.run({
      ...base,
      prompt: RESUME_PROMPT,
      resume: first.sessionId!,
      timeoutMs: 120_000,
    });
    await save(CLAUDE_FIXTURES, 'sdk-resume-turn.jsonl', raw, clean);

    raw = [];
    const marker = '41.137';
    const controller = new AbortController();
    let toolSeenAt = 0;
    const started = Date.now();
    const cancelled = runner
      .run({
        ...base,
        prompt: sleepPrompt(marker),
        signal: controller.signal,
        timeoutMs: 120_000,
        onEvent: (e) => {
          if (e.type === 'tool' && !toolSeenAt) {
            toolSeenAt = Date.now();
            setTimeout(() => controller.abort(), 2_000);
          }
        },
      })
      .then(
        () => 'completed',
        (e: Error & { kind?: string }) => e.kind ?? e.message,
      );
    const outcome = await cancelled;
    const settledMs = Date.now() - started;
    await wait(7_000);
    await save(CLAUDE_FIXTURES, 'sdk-cancel-during-tool.jsonl', raw, clean);
    return {
      path: 'claude-sdk',
      version: `${TESTED_RUNTIMES.claudeAgentSdk} (bundled CLI ${TESTED_RUNTIMES.claudeSdkCli})`,
      resume: {
        sameSession: second.sessionId === first.sessionId,
        firstCost: first.costUsd,
        secondCost: second.costUsd,
      },
      cancel: { toolStarted: toolSeenAt > 0, outcome, settledMs, descendantsAfter7s: survivors(marker) },
    };
  });
}

/** Detached review turns: `claude -p --output-format stream-json`, stopped with SIGTERM to the group. */
async function claudeCliPath() {
  return withDir(async (dir) => {
    const clean = sanitizer(dir);
    const systemPromptFile = join(dir, 'system.md');
    await writeFile(systemPromptFile, 'You are a test agent.');
    const turn = (message: string, resume?: string) =>
      claudeCli.args(
        { model: CLAUDE_MODEL, message, systemPromptFile, deny: [], ...(resume ? { resume } : {}) },
        { systemPrompt: '' },
      );
    const runDetached = async (args: string[], name: string, stopAfterTool = false) => {
      const log = join(dir, `${name}.log`);
      const exit = join(dir, `${name}.exit`);
      const pid = spawnDetached(claudeCli.command, args, {
        cwd: dir,
        logPath: log,
        exitPath: exit,
        env: { ...process.env, ...claudeCli.env?.({} as never) },
      });
      const started = Date.now();
      let stoppedAt = 0;
      for (;;) {
        await wait(250);
        const text = await readFile(log, 'utf8').catch(() => '');
        if (stopAfterTool && !stoppedAt && text.includes('"tool_use"')) {
          await wait(2_000);
          stoppedAt = Date.now();
          stopGroup(pid);
        }
        const code = await readFile(exit, 'utf8').catch(() => undefined);
        if (code !== undefined || !isAlive(pid)) {
          return {
            lines: text.split('\n').filter(Boolean),
            exit: code?.trim() ?? 'none',
            ms: Date.now() - started,
            stopLatencyMs: stoppedAt ? Date.now() - stoppedAt : undefined,
          };
        }
        if (Date.now() - started > 120_000) {
          stopGroup(pid);
          return { lines: text.split('\n').filter(Boolean), exit: 'timeout', ms: Date.now() - started };
        }
      }
    };
    const first = await runDetached(turn(TOOL_PROMPT), 'tool');
    await save(CLAUDE_FIXTURES, 'cli-tool-turn.jsonl', first.lines, clean);
    const session = first.lines
      .map((l) => JSON.parse(l) as { session_id?: string })
      .find((e) => e.session_id)?.session_id;
    const second = await runDetached(turn(RESUME_PROMPT, session), 'resume');
    await save(CLAUDE_FIXTURES, 'cli-resume-turn.jsonl', second.lines, clean);
    const resumedSession = second.lines
      .map((l) => JSON.parse(l) as { session_id?: string })
      .find((e) => e.session_id)?.session_id;
    const marker = '42.137';
    const cancel = await runDetached(turn(sleepPrompt(marker)), 'cancel', true);
    await wait(7_000);
    await save(CLAUDE_FIXTURES, 'cli-cancel-during-tool.jsonl', cancel.lines, clean);
    return {
      path: 'claude-cli (detached review turn)',
      version: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
      resume: { sameSession: !!session && resumedSession === session },
      cancel: {
        exitFile: cancel.exit,
        stopLatencyMs: cancel.stopLatencyMs,
        lastEvent: cancel.lines.at(-1)?.slice(0, 80),
        descendantsAfter7s: survivors(marker),
      },
    };
  });
}

/** Codex: `codex exec --json` through the runner, with stdout and stderr captured apart. */
async function codex() {
  return withDir(async (dir) => {
    const clean = sanitizer(dir);
    const capture = async (prompt: string, resume?: string) => {
      const args = execArgs({
        sandbox: 'workspace-write',
        effort: 'low',
        cwd: dir,
        prompt,
        ...(resume ? { resume } : {}),
      });
      const out = spawnSync('codex', args, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180_000,
      });
      return { stdout: (out.stdout ?? '').split('\n').filter(Boolean), stderr: out.stderr ?? '' };
    };
    const first = await capture(TOOL_PROMPT);
    await save(CODEX_FIXTURES, 'exec-tool-turn.jsonl', first.stdout, clean);
    const thread = first.stdout
      .map((l) => JSON.parse(l) as { thread_id?: string })
      .find((e) => e.thread_id)?.thread_id;
    const second = await capture(RESUME_PROMPT, thread);
    await save(CODEX_FIXTURES, 'exec-resume-turn.jsonl', second.stdout, clean);
    const resumedThread = second.stdout
      .map((l) => JSON.parse(l) as { thread_id?: string })
      .find((e) => e.thread_id)?.thread_id;

    const marker = '43.137';
    const controller = new AbortController();
    let toolSeenAt = 0;
    const lines: string[] = [];
    const started = Date.now();
    const runner = new CodexRunner();
    const outcome = await runner
      .run({
        model: 'codex',
        effort: 'low',
        systemPrompt: '',
        prompt: sleepPrompt(marker),
        tools: 'edit',
        cwd: dir,
        signal: controller.signal,
        timeoutMs: 180_000,
        onEvent: (e) => {
          lines.push(JSON.stringify(e));
          if (e.type === 'tool' && !toolSeenAt) {
            toolSeenAt = Date.now();
            setTimeout(() => controller.abort(), 2_000);
          }
        },
      })
      .then(
        () => 'completed',
        (e: Error & { kind?: string }) => e.kind ?? e.message,
      );
    const settledMs = Date.now() - started;
    await wait(7_000);
    return {
      path: 'codex exec --json',
      version: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(),
      stderrOnToolTurn: clean(first.stderr).split('\n').filter(Boolean).slice(0, 5),
      resume: { sameThread: !!thread && resumedThread === thread },
      cancel: {
        toolStarted: toolSeenAt > 0,
        outcome,
        settledMs,
        normalizedEvents: lines.length,
        descendantsAfter7s: survivors(marker),
      },
    };
  });
}

const PATHS = { 'claude-sdk': claudeSdk, 'claude-cli': claudeCliPath, codex } as const;
const chosen = (
  process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PATHS)
) as (keyof typeof PATHS)[];
const summary = [];
for (const name of chosen) {
  try {
    summary.push(await PATHS[name]());
  } catch (error) {
    summary.push({ path: name, error: (error as Error).message.slice(0, 500) });
  }
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
