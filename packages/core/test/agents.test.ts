import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelLadder, ModelRef, parseModelRef, ProviderRouter, type ModelRun } from '../src/index.ts';

const call = (over: Partial<ModelRun>): ModelRun => ({
  model: 'claude-sonnet-5-5',
  effort: 'low',
  systemPrompt: '',
  prompt: 'p',
  tools: 'none',
  ...over,
});

test('model references name the provider; ladders accept codex rungs', () => {
  assert.deepEqual(parseModelRef('claude-opus-5-5'), { provider: 'claude', model: 'claude-opus-5-5' });
  assert.deepEqual(parseModelRef('codex'), { provider: 'codex' });
  assert.deepEqual(parseModelRef('codex:gpt-5.5'), { provider: 'codex', model: 'gpt-5.5' });
  assert.equal(ModelRef.safeParse('gpt-5.5').success, false);
  assert.ok(
    ModelLadder.safeParse({ name: 'x', rungs: [{ name: 'r', model: 'codex', effort: 'low' }] }).success,
  );
});

test('the router sends each call to its provider and refuses what the provider cannot enforce', async () => {
  const seen: string[] = [];
  const router = new ProviderRouter({
    claude: { run: async (r) => (seen.push(`claude:${r.model}`), { text: 'c', costUsd: 1 }) },
    codex: { run: async (r) => (seen.push(`codex:${r.model}`), { text: 'x', costUsd: null }) },
  });
  await router.run(call({}));
  await router.run(call({ model: 'codex', tools: 'read-only', outputSchema: {} }));
  assert.deepEqual(seen, ['claude:claude-sonnet-5-5', 'codex:codex']);
  // A guarded step needs every tool call screened; Codex cannot, so it never sees the call.
  await assert.rejects(
    router.run(call({ step: 'coder', model: 'codex', tools: 'edit', guard: { check: () => undefined } })),
    /coder: codex cannot screen each tool call/,
  );
  assert.equal(seen.length, 2);
  assert.match(
    new ProviderRouter({ claude: { run: async () => ({ text: '', costUsd: 0 }) } }).refusal(
      call({ model: 'codex' }),
    )!,
    /not available/,
  );
});
