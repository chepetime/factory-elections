// The execution lifecycle contract: every background execution that adopts Executions gets these.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentPool, ExecutionRefused, Executions, type ExecutionSpec } from '../src/index.ts';

function setup(max = 2) {
  const pool = new AgentPool({ max, pollMs: 10_000 });
  return { pool, executions: new Executions({ pool, log: () => {} }) };
}

/** A spec whose work waits for its signal or for `finish()`; `ends` records each finalize. */
function spec(key: string, options: { accept?: () => Promise<void>; fail?: boolean } = {}) {
  const ends: { outcome: string; error?: string }[] = [];
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const value: ExecutionSpec = {
    key,
    action: 'step',
    accept: options.accept ?? (async () => {}),
    work: (signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        void done.then(() => (options.fail ? reject(new Error('model failed')) : resolve()));
      }),
    finalize: async (result) => void ends.push(result),
  };
  return { value, ends, finish };
}

test('work holds a slot while it runs, and finalizes once as completed', async () => {
  const { pool, executions } = setup();
  const a = spec('p/a');
  await executions.submit(a.value);
  assert.equal(pool.inUse(), 1);
  assert.equal(executions.observe('p/a')?.action, 'step');
  a.finish();
  await executions.settled('p/a');
  assert.deepEqual(a.ends, [{ outcome: 'completed' }]);
  assert.equal(pool.inUse(), 0);
  assert.equal(executions.observe('p/a'), undefined);
});

test('a failed accept refuses the work, finalizes it as failed, and leaks no slot', async () => {
  const { pool, executions } = setup();
  const a = spec('p/a', { accept: async () => Promise.reject(new Error('disk full')) });
  await assert.rejects(executions.submit(a.value), /disk full/);
  assert.deepEqual(a.ends, [{ outcome: 'failed', error: 'disk full' }]);
  assert.equal(pool.inUse(), 0);
  assert.equal(executions.observe('p/a'), undefined);
});

test('a failing work finalizes as failed with its error', async () => {
  const { executions } = setup();
  const a = spec('p/a', { fail: true });
  await executions.submit(a.value);
  a.finish();
  await executions.settled('p/a');
  assert.deepEqual(a.ends, [{ outcome: 'failed', error: 'model failed' }]);
});

test('interrupt aborts the work and it finalizes as cancelled, not failed', async () => {
  const { pool, executions } = setup();
  const a = spec('p/a');
  await executions.submit(a.value);
  assert.equal(executions.interrupt('p/a'), true);
  assert.equal(executions.observe('p/a')?.stopping, true);
  await executions.settled('p/a');
  assert.deepEqual(a.ends, [{ outcome: 'cancelled' }]);
  assert.equal(pool.inUse(), 0);
  assert.equal(executions.interrupt('p/a'), false, 'nothing runs any more');
});

test('one execution per key, and none past the pool', async () => {
  const { executions } = setup(1);
  const a = spec('p/a');
  await executions.submit(a.value);
  await assert.rejects(executions.submit(spec('p/a').value), ExecutionRefused);
  await assert.rejects(executions.submit(spec('p/b').value), /Every agent slot is in use/);
  a.finish();
  await executions.settled('p/a');
  await executions.submit(spec('p/b').value);
});

test('drain refuses new work, interrupts what outlasts the grace period, and waits for finalize', async () => {
  const { pool, executions } = setup();
  const a = spec('p/a');
  await executions.submit(a.value);
  await executions.drain(20);
  assert.deepEqual(a.ends, [{ outcome: 'interrupted' }]);
  assert.equal(pool.inUse(), 0);
  await assert.rejects(executions.submit(spec('p/b').value), /shutting down/);
});

test('interruptAll stops every running execution and counts them', async () => {
  const { pool, executions } = setup();
  const a = spec('p/a');
  const b = spec('p/b');
  await executions.submit(a.value);
  await executions.submit(b.value);
  assert.equal(executions.interruptAll(), 2);
  await Promise.all([executions.settled('p/a'), executions.settled('p/b')]);
  assert.deepEqual([...a.ends, ...b.ends], [{ outcome: 'cancelled' }, { outcome: 'cancelled' }]);
  assert.equal(pool.inUse(), 0);
  assert.equal(executions.interruptAll(), 0);
});
