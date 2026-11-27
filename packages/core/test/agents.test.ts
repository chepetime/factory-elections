import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ModelLadder,
  ModelRef,
  parseModelRef,
  PROVIDER_CAPABILITIES,
  ProviderRouter,
  tokenCapForModel,
  type ModelRun,
} from '../src/index.ts';

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

test('the router refuses a Codex call with a dollar limit and no token cap', async () => {
  const seen: ModelRun[] = [];
  const run = async (r: ModelRun) => (seen.push(r), { text: 'x', costUsd: null });
  // The exec transport sees usage only when the turn ends, so it cannot hold a limit.
  const exec = new ProviderRouter({ codex: { run } });
  const limited = call({ model: 'codex', step: 'coder', maxBudgetUsd: 0.5 });
  assert.match(exec.refusal(limited)!, /codex cannot stop at a dollar limit/);
  await assert.rejects(exec.run(limited), /coder: codex cannot stop at a dollar limit/);
  assert.match(exec.refusal(call({ model: 'codex', maxTokens: 1000 }))!, /token limit/);
  assert.equal(seen.length, 0, 'the provider never sees a call it cannot bound');
  // Without a limit the call is allowed: time limits still hold.
  assert.equal(exec.refusal(call({ model: 'codex' })), undefined);
  // Claude stops at the dollar limit itself.
  assert.equal(new ProviderRouter({ claude: { run } }).refusal(call({ maxBudgetUsd: 1 })), undefined);

  // The app-server transport takes the limit: a dollar limit reaches it as a token cap.
  const appServer = new ProviderRouter({
    codex: { run, capabilities: { ...PROVIDER_CAPABILITIES.codex, tokenCap: true } },
  });
  const priced = call({ model: 'codex:gpt-5-codex', step: 'coder', maxBudgetUsd: 0.5 });
  await appServer.run(priced);
  assert.equal(seen[0]!.maxTokens, tokenCapForModel('codex:gpt-5-codex', 0.5));
  assert.equal(seen[0]!.maxTokens, 50_000, 'at the dearest rate, $10 per million tokens');
  assert.match(
    appServer.refusal(limited)!,
    /no entry in the price table/,
    'an unpriced model gets no guessed cap',
  );
  await appServer.run(call({ model: 'codex', maxBudgetUsd: 0.5, maxTokens: 123 }));
  assert.equal(seen[1]!.maxTokens, 123, 'an explicit token cap wins');
});
