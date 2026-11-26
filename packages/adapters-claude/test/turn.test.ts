// The SDK turn path, with a fake SDK query: no model is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HeadlessTurn } from '@factory/core';
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
  assert.equal(flag(args, '--setting-sources'), 'project');
  assert.deepEqual(options.settingSources, ['project']);
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
  assert.deepEqual(options.allowedTools, [CLAUDE_DELEGATE_TOOL]);
  assert.equal(flag(args, '--allowedTools'), CLAUDE_DELEGATE_TOOL);
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
  if (turn.deny.length) {
    const rule = /^Bash\((.*?)(:\*)?\)$/.exec(turn.deny[0]!)?.[1];
    if (rule)
      assert.equal((await ask('Bash', { command: `${rule} 1` }, { signal } as never))?.behavior, 'deny');
  }
});
