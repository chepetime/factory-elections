// Provider version checks, with a fake command runner: no CLI is called.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseVersion, TESTED_RUNTIMES } from '@factory/core';
import { runtimeVersionChecks } from '../src/diagnostics.ts';

type Out = { code: number | null; stdout: string };
const runner =
  (outputs: Record<string, Out>) =>
  async (command: string): Promise<Out> =>
    outputs[command] ?? { code: 127, stdout: '' };

test('version lines from claude and codex parse to x.y.z', () => {
  assert.equal(parseVersion('2.1.331 (Claude Code)\n'), '2.1.331');
  assert.equal(parseVersion('codex-cli 0.172.0\n'), '0.172.0');
  assert.equal(parseVersion('unknown'), undefined);
});

test('tested versions say so; other versions say behavior is not verified; none fail', async () => {
  const tested = await runtimeVersionChecks(
    runner({
      claude: { code: 0, stdout: `${TESTED_RUNTIMES.claudeCli} (Claude Code)\n` },
      codex: { code: 0, stdout: `codex-cli ${TESTED_RUNTIMES.codexCli}\n` },
    }),
  );
  assert.ok(tested.every((c) => c.ok));
  assert.match(tested[0]!.detail, /\(tested\)$/);
  assert.match(tested[2]!.detail, /\(tested\)$/);

  const other = await runtimeVersionChecks(runner({ claude: { code: 0, stdout: '9.9.9 (Claude Code)\n' } }));
  assert.ok(other.every((c) => c.ok));
  assert.match(other[0]!.detail, /^9\.9\.9; tested with .* not verified$/);
  assert.equal(other[2]!.detail, 'codex not installed (optional)');
  assert.match(other[1]!.detail, new RegExp(TESTED_RUNTIMES.claudeAgentSdk.replaceAll('.', '\\.')));
});

test('the tested Claude Agent SDK pin matches the lockfile, so a bump updates the pin and fixtures', async () => {
  const lock = await readFile(fileURLToPath(new URL('../../../pnpm-lock.yaml', import.meta.url)), 'utf8');
  const locked = /'?@anthropic-ai\/claude-agent-sdk@(\d+\.\d+\.\d+)/.exec(lock)?.[1];
  assert.equal(locked, TESTED_RUNTIMES.claudeAgentSdk);
});
