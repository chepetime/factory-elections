// The SDK turn path, with a fake SDK query: no model is called.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { factorySecretFiles, type HeadlessTurn } from '@factory/core';
import { claudeCli, claudeTurnOptions, runClaudeTurn, CLAUDE_DELEGATE_TOOL } from '../src/index.ts';

const turn: HeadlessTurn = {
  message: 'Review PR #7',
  systemPromptFile: '/tmp/prompt.md',
  resume: 's-1',
  budgetUsd: 25,
  deny: ['Bash(git push:*)', 'Bash(gh api:*)'],
  mcp: { url: 'http://127.0.0.1:1/mcp', token: 'tok' },
  tools: ['Read', 'Bash'],
};

/** The value after `flag` in the CLI arguments, or true when the flag has none. */
function flag(args: string[], name: string): string | true | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const next = args[at + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

test('SDK turn options set what the CLI turn arguments set', () => {
  const args = claudeCli.args(turn, { systemPrompt: '' });
  const options = claudeTurnOptions(
    { turn, systemPrompt: 'SKILL', cwd: '/w', env: {} },
    new AbortController(),
  );
  assert.equal(flag(args, '--dangerously-skip-permissions'), true);
  // The SDK runs in default mode with a guard; see the guard test below.
  assert.equal(options.permissionMode, 'default');
  assert.equal(typeof options.canUseTool, 'function');
  // No settings source is loaded; the SDK sends `settingSources: []` as `--setting-sources=`.
  assert.ok(args.includes('--setting-sources='));
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.sandbox, undefined, 'a turn that asks for no sandbox gets none');
  assert.equal(flag(args, '--settings'), undefined);
  assert.equal(flag(args, '--strict-mcp-config'), true);
  assert.equal(options.strictMcpConfig, true);
  assert.equal(flag(args, '--disable-slash-commands'), true);
  assert.deepEqual(options.skills, []);
  assert.deepEqual(options.extraArgs, { 'disable-slash-commands': null });
  assert.equal(options.model, flag(args, '--model'));
  assert.equal(String(options.maxBudgetUsd), flag(args, '--max-budget-usd'));
  assert.deepEqual(options.tools, (flag(args, '--tools') as string).split(','));
  assert.deepEqual(options.disallowedTools, turn.deny);
  assert.deepEqual(
    args.slice(
      args.indexOf('--disallowedTools') + 1,
      args.indexOf('--disallowedTools') + 1 + turn.deny.length,
    ),
    turn.deny,
  );
  // The CLI pre-approves the delegate tool because it skips permissions; the SDK leaves it to the
  // guard, since a bare allowedTools entry would bypass canUseTool.
  assert.equal(flag(args, '--allowedTools'), CLAUDE_DELEGATE_TOOL);
  assert.equal(options.allowedTools, undefined);
  assert.ok(options.mcpServers && 'factory' in options.mcpServers);
  assert.equal(options.resume, flag(args, '--resume'));
  assert.equal(options.persistSession, true);
  assert.deepEqual(options.systemPrompt, { type: 'preset', preset: 'claude_code', append: 'SKILL' });
  assert.equal(options.cwd, '/w');
  assert.ok(options.env?.MCP_TOOL_TIMEOUT);
});

type Query = NonNullable<Parameters<typeof runClaudeTurn>[1]>;
const fake = (messages: unknown[], fail?: Error): Query =>
  ((args: { options: { abortController: AbortController } }) =>
    (async function* () {
      for (const m of messages) {
        if (args.options.abortController.signal.aborted) throw new Error('aborted by user');
        yield m;
      }
      if (fail) throw fail;
    })()) as unknown as Query;

test('a turn streams every SDK message as a line and returns its result', async () => {
  const lines: string[] = [];
  const result = await runClaudeTurn(
    {
      turn,
      systemPrompt: '',
      cwd: '/w',
      env: {},
      signal: new AbortController().signal,
      onLine: (l) => lines.push(l),
    },
    fake([
      { type: 'system', subtype: 'init', session_id: 's-2' },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        total_cost_usd: 1.5,
        session_id: 's-2',
      },
    ]),
  );
  assert.equal(lines.length, 2);
  assert.deepEqual(result, { ok: true, aborted: false, reported: true, sessionId: 's-2', costUsd: 1.5 });
});

test('a failed or aborted turn says so and never throws', async () => {
  const base = { turn, systemPrompt: '', cwd: '/w', env: {}, onLine: () => {} };
  const failed = await runClaudeTurn(
    { ...base, signal: new AbortController().signal },
    fake([{ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: [] }]),
  );
  assert.deepEqual([failed.ok, failed.reported, failed.error], [false, true, 'error_max_budget_usd']);
  const thrown = await runClaudeTurn(
    { ...base, signal: new AbortController().signal },
    fake([], new Error('spawn failed')),
  );
  assert.deepEqual([thrown.ok, thrown.reported, thrown.error], [false, false, 'spawn failed']);
  const controller = new AbortController();
  controller.abort();
  const aborted = await runClaudeTurn({ ...base, signal: controller.signal }, fake([{ type: 'system' }]));
  assert.deepEqual([aborted.ok, aborted.aborted], [false, true]);
});

test('the SDK review guard allows tools except what a deny rule names, also inside compound commands', async () => {
  const { deniedBy } = await import('../src/index.ts');
  const deny = ['Bash(gh pr review:*)', 'Bash(git push:*)', 'WebFetch'];
  assert.equal(
    deniedBy(deny, 'Write', { file_path: '/d/payload.json' }),
    undefined,
    'saving the report is allowed',
  );
  assert.equal(deniedBy(deny, 'Bash', { command: 'git diff main...HEAD' }), undefined);
  assert.equal(deniedBy(deny, 'Bash', { command: 'gh pr view 4 --json state' }), undefined);
  assert.equal(deniedBy(deny, 'Bash', { command: 'gh pr review 4 --approve' }), 'Bash(gh pr review:*)');
  assert.equal(deniedBy(deny, 'Bash', { command: 'git status && git push origin x' }), 'Bash(git push:*)');
  assert.equal(deniedBy(deny, 'Bash', { command: 'echo hi; gh pr review 4' }), 'Bash(gh pr review:*)');
  assert.equal(deniedBy(deny, 'WebFetch', { url: 'x' }), 'WebFetch');
  const options = claudeTurnOptions({ turn, systemPrompt: 'S', cwd: '/w', env: {} }, new AbortController());
  const ask = options.canUseTool!;
  const signal = new AbortController().signal;
  assert.equal((await ask('Write', { file_path: '/p' }, { signal } as never))?.behavior, 'allow');
  // The delegate tool goes through the guard too: allowed by default, refused when a rule names it.
  assert.equal((await ask(CLAUDE_DELEGATE_TOOL, {}, { signal } as never))?.behavior, 'allow');
  const noDelegate = claudeTurnOptions(
    { turn: { ...turn, deny: [...turn.deny, CLAUDE_DELEGATE_TOOL] }, systemPrompt: 'S', cwd: '/w', env: {} },
    new AbortController(),
  );
  assert.equal(
    (await noDelegate.canUseTool!(CLAUDE_DELEGATE_TOOL, {}, { signal } as never))?.behavior,
    'deny',
  );
  if (turn.deny.length) {
    const rule = /^Bash\((.*?)(:\*)?\)$/.exec(turn.deny[0]!)?.[1];
    if (rule)
      assert.equal((await ask('Bash', { command: `${rule} 1` }, { signal } as never))?.behavior, 'deny');
  }
});

const reviewTurn: HeadlessTurn = {
  ...turn,
  sandbox: { allowWrite: ['/data/reviews/app-feat', '/data/app/reviews/7/work'] },
};

test('a review turn runs in an OS sandbox: no credential stores, writes only to its dirs, no network', () => {
  const options = claudeTurnOptions(
    { turn: reviewTurn, systemPrompt: 'S', cwd: '/w', env: {} },
    new AbortController(),
  );
  const sandbox = options.sandbox!;
  assert.equal(sandbox.enabled, true);
  assert.equal(sandbox.failIfUnavailable, true);
  assert.equal(sandbox.autoAllowBashIfSandboxed, false);
  assert.equal(sandbox.allowUnsandboxedCommands, false);
  const home = homedir();
  assert.deepEqual(sandbox.filesystem?.denyRead, [
    join(home, '.ssh'),
    join(home, '.npmrc'),
    join(home, '.aws'),
    join(home, '.config', 'gh'),
    join(home, 'Library', 'Keychains'),
    ...factorySecretFiles(home),
  ]);
  assert.deepEqual(sandbox.filesystem?.allowWrite, reviewTurn.sandbox!.allowWrite);
  assert.deepEqual(sandbox.network?.allowedDomains, [], 'no network unless the turn names domains');
  const withDomain = claudeTurnOptions(
    {
      turn: { ...reviewTurn, sandbox: { allowWrite: ['/w'], allowedDomains: ['api.example.com'] } },
      systemPrompt: '',
      cwd: '/w',
      env: {},
    },
    new AbortController(),
  );
  assert.deepEqual(withDomain.sandbox?.network?.allowedDomains, ['api.example.com']);
});

test('the CLI path carries the same sandbox as inline --settings', () => {
  const args = claudeCli.args(reviewTurn, { systemPrompt: '' });
  const options = claudeTurnOptions(
    { turn: reviewTurn, systemPrompt: '', cwd: '/w', env: {} },
    new AbortController(),
  );
  const settings = JSON.parse(flag(args, '--settings') as string) as { sandbox: unknown };
  assert.deepEqual(settings, { sandbox: options.sandbox });
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--disable-slash-commands'));
  assert.equal(flag(args, '--tools'), 'Read,Bash');
});

test('a review turn does not load the pull request own settings or hooks, on either path', () => {
  const args = claudeCli.args(reviewTurn, { systemPrompt: '' });
  const options = claudeTurnOptions(
    { turn: reviewTurn, systemPrompt: '', cwd: '/review/worktree', env: {} },
    new AbortController(),
  );
  // The worktree's .claude/settings.json (hooks included) is the PR author's: no source reads it.
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.hooks, undefined);
  assert.ok(args.includes('--setting-sources='), 'the SDK sends an empty list as this exact argument');
  assert.ok(!args.includes('project'));
  assert.ok(!args.includes('--setting-sources'), 'no separate value that could name a source');
});

test('a Claude turn that hits its budget reports kind budget, with its cost', async () => {
  const base = { turn, systemPrompt: '', cwd: '/w', env: {}, onLine: () => {} };
  const stopped = await runClaudeTurn(
    { ...base, signal: new AbortController().signal },
    fake([
      { type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: [], total_cost_usd: 0.06 },
    ]),
  );
  assert.deepEqual([stopped.ok, stopped.kind, stopped.costUsd], [false, 'budget', 0.06]);
  // Any other failure has no kind, so a caller cannot mistake it for a spend stop.
  const failed = await runClaudeTurn(
    { ...base, signal: new AbortController().signal },
    fake([{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }]),
  );
  assert.equal(failed.kind, undefined);
});
