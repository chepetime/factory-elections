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

test('an unconfirmed uncertain cleanup blocks run and revise only', async () => {
  const { cleanupBlocker, taskActions } = await import('../src/index.ts');
  assert.equal(cleanupBlocker(undefined), undefined);
  assert.equal(cleanupBlocker({ status: 'clean' }), undefined);
  assert.equal(cleanupBlocker({ status: 'uncertain', reasons: ['x'], confirmed_at: 't' }), undefined);
  assert.match(
    cleanupBlocker({ status: 'uncertain', reasons: ['codex was stopped'] }) ?? '',
    /\(codex was stopped\)/,
  );
  const task = { id: 't', project: 'p', repo: '/r', prompt: 'x', stage: 'failed' } as never;
  const blocked = taskActions(task, 'failed', undefined, { status: 'uncertain' });
  const codes = (action: string) => blocked.find((a) => a.action === action)!.blockers.map((b) => b.code);
  assert.ok(codes('run').includes('cleanup'));
  assert.ok(codes('revise').includes('cleanup'));
  assert.ok(!codes('reject').includes('cleanup'), 'rejecting the task stays possible');
  assert.equal(taskActions(task, 'failed').find((a) => a.action === 'run')!.allowed, true);
});
