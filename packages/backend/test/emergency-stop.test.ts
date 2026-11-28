import assert from 'node:assert/strict';
import test from 'node:test';
import { UserSettings, type ModelRun, type ModelRunner } from '@factory/core';
import { EmergencyStop } from '../src/emergency-stop.ts';
import { gatedRunner, reviewRefusal } from '../src/model-gate.ts';

function documents() {
  const docs = new Map<string, unknown>();
  return {
    docs,
    readDocument: async (path: string) => {
      if (!docs.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return structuredClone(docs.get(path));
    },
    writeDocument: async (path: string, value: unknown) => void docs.set(path, structuredClone(value)),
  };
}

const counts = { runs: 2, reviews: 1, executions: 3 };

test('the switch is off by default, and a stop holds across a new instance until resumed', async () => {
  const storage = documents();
  const make = () => new EmergencyStop({ root: '/data', storage, interrupt: async () => counts });
  const first = make();
  assert.deepEqual(await first.load(), { on: false });
  assert.equal(first.refusal(), undefined);

  const state = await first.stop();
  assert.equal(state.on, true);
  assert.deepEqual(state.stopped, counts);
  assert.ok([...storage.docs.keys()][0]?.endsWith('.workspace/emergency-stop.json'));

  const restarted = make();
  assert.equal((await restarted.load()).on, true, 'a restart keeps the stop');
  assert.match(restarted.refusal()!, /emergency stop is on/);

  await restarted.resume();
  assert.equal((await make().load()).on, false);
});

test('the switch refuses work before the interrupt finishes, and a second press keeps the time', async () => {
  let seenOn: boolean | undefined;
  const stop: EmergencyStop = new EmergencyStop({
    root: '/data',
    storage: documents(),
    interrupt: async () => {
      seenOn = stop.on;
      return counts;
    },
  });
  const first = await stop.stop();
  assert.equal(seenOn, true, 'the interrupt runs with the switch already on');
  const again = await stop.stop();
  assert.equal(again.since, first.since);
});

test('the model gate and the review gate refuse while the stop is on', async () => {
  const seen: ModelRun[] = [];
  const base: ModelRunner = { run: async (r) => (seen.push(r), { text: 'ok', costUsd: 0 }) };
  const user = { get: async () => UserSettings.parse({}) };
  let on = true;
  const halt = { refusal: () => (on ? 'The emergency stop is on.' : undefined) };
  const runner = gatedRunner(() => base, user, halt);
  const call = { step: 'chat', model: 'claude-sonnet-5-5', systemPrompt: '', prompt: 'hi' } as ModelRun;
  await assert.rejects(runner.run(call), /emergency stop is on/);
  assert.equal(seen.length, 0);
  assert.match((await reviewRefusal(user, 'claude-sonnet-5-5', halt))!, /emergency stop is on/);
  on = false;
  await runner.run(call);
  assert.equal(seen.length, 1);
  assert.equal(await reviewRefusal(user, 'claude-sonnet-5-5', halt), undefined);
});
