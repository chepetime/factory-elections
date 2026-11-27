import assert from 'node:assert/strict';
import test from 'node:test';
import { UserSettings, type ModelRun, type ModelRunner } from '@factory/core';
import { gatedRunner } from '../src/model-gate.ts';

function recorder() {
  const seen: ModelRun[] = [];
  const base: ModelRunner = {
    run: async (request) => {
      seen.push(request);
      return { text: 'ok', costUsd: 0 };
    },
  };
  return { seen, base };
}

const call = { step: 'fix-ci', model: 'claude-opus-5-5', systemPrompt: '', prompt: 'fix it' } as ModelRun;

test('the gate refuses a disabled model for any caller, such as fix-ci in tending', async () => {
  const { seen, base } = recorder();
  const user = UserSettings.parse({ providers: { claude: { disabled_models: ['claude-opus-5-5'] } } });
  const runner = gatedRunner(() => base, { get: async () => user });
  await assert.rejects(runner.run(call), /claude-opus-5-5 is turned off in your user settings/);
  assert.equal(seen.length, 0);
  await runner.run({ ...call, model: 'claude-sonnet-5-5' });
  assert.equal(seen.length, 1);
});

test('the gate refuses a turned-off provider', async () => {
  const { seen, base } = recorder();
  const user = UserSettings.parse({ providers: { codex: { enabled: false } } });
  const runner = gatedRunner(() => base, { get: async () => user });
  await assert.rejects(runner.run({ ...call, model: 'codex:gpt-6-astra' }), /Codex is turned off/);
  assert.equal(seen.length, 0);
});

test('a call with no model runs the default model from the user settings', async () => {
  const { seen, base } = recorder();
  const user = UserSettings.parse({ providers: { claude: { default_model: 'claude-sonnet-5-5' } } });
  await gatedRunner(() => base, { get: async () => user }).run({ ...call, model: '' });
  assert.equal(seen[0]?.model, 'claude-sonnet-5-5');
});
