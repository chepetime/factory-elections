import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  combineCleanup,
  errorCleanup,
  failureOutcome,
  ProviderRouter,
  PROVIDER_CAPABILITIES,
  runOutcome,
  withSession,
  type ModelRun,
} from '../src/index.ts';

test('one uncertain call makes the cleanup uncertain, with each reason once', () => {
  assert.deepEqual(combineCleanup([]), { status: 'clean' });
  assert.deepEqual(combineCleanup([{ status: 'clean' }]), { status: 'clean' });
  assert.deepEqual(
    combineCleanup([
      { status: 'uncertain', reason: 'a' },
      { status: 'clean' },
      { status: 'uncertain', reason: 'a' },
      { status: 'uncertain' },
    ]),
    { status: 'uncertain', reasons: ['a', 'unknown'] },
  );
});

test('a stop is cancelled, any other error failed; old records derive their outcome from state', () => {
  assert.equal(failureOutcome('error', true), 'cancelled');
  assert.equal(failureOutcome('aborted', false), 'cancelled');
  assert.equal(failureOutcome('timeout', false), 'failed');
  assert.equal(failureOutcome(undefined, false), 'failed');
  assert.equal(runOutcome({ state: 'failed' }), 'failed');
  assert.equal(runOutcome({ state: 'failed', outcome: 'cancelled' }), 'cancelled');
  assert.equal(runOutcome({ state: 'running' }), undefined);
});

test('a session reference appears once per provider and native id, refreshed', () => {
  const a = { provider: 'claude' as const, native_id: 's1', scope: 'task' as const, last_used_at: '1' };
  const sessions = withSession(withSession([a], { ...a, native_id: 's2' }), { ...a, last_used_at: '2' });
  assert.deepEqual(
    sessions.map((s) => [s.native_id, s.last_used_at]),
    [
      ['s2', '1'],
      ['s1', '2'],
    ],
  );
});

test('only errors with valid cleanup evidence report it', () => {
  assert.deepEqual(errorCleanup({ cleanup: { status: 'uncertain', reason: 'x' } }), {
    status: 'uncertain',
    reason: 'x',
  });
  assert.equal(errorCleanup(new Error('plain')), undefined);
  assert.equal(errorCleanup({ cleanup: { status: 'maybe' } }), undefined);
  assert.equal(errorCleanup(null), undefined);
});

test('the router checks the capabilities a runner declares, before the provider defaults', () => {
  const request: ModelRun = {
    model: 'claude-sonnet-5-5',
    effort: 'low',
    systemPrompt: '',
    prompt: 'x',
    tools: 'edit',
    guard: { check: () => undefined },
  };
  const run = async () => ({ text: '', costUsd: 0 });
  assert.equal(new ProviderRouter({ claude: { run } }).refusal(request), undefined);
  const weaker = { ...PROVIDER_CAPABILITIES.claude, toolGuard: false };
  assert.match(
    new ProviderRouter({ claude: { run, capabilities: weaker } }).refusal(request) ?? '',
    /cannot screen each tool call/,
  );
  assert.equal(PROVIDER_CAPABILITIES.codex.descendantCleanup, false);
});
