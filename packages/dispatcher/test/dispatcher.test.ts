import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentPool, Dispatcher, type Job } from '../src/index.ts';

const tick = () => new Promise((done) => setTimeout(done, 5));
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 400 && !check(); i++) await tick();
  assert.ok(check(), what);
}

/** A job whose work runs until `finish()`; `events` records what happened to it. */
function job(run: string, events: string[], agent?: { name: string; limit: number }) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const spec: Job = {
    task: `demo/${run}`,
    run,
    agent: async () => agent,
    work: async () => {
      events.push(`work:${run}`);
      await done;
    },
    cancelled: async () => void events.push(`cancelled:${run}`),
    settle: async () => void events.push(`settle:${run}`),
  };
  return { spec, finish };
}

function setup(options: { workers?: number; max?: number; external?: () => Promise<number> } = {}) {
  const pool = new AgentPool({ max: options.max ?? 6, pollMs: 10_000, external: options.external });
  const dispatcher = new Dispatcher({ workers: options.workers ?? 3, pool, log: () => {} });
  const events: string[] = [];
  const add = (run: string, agent?: { name: string; limit: number }) => {
    const created = job(run, events, agent);
    dispatcher.schedule(created.spec, dispatcher.reserve()!);
    return created;
  };
  return { pool, dispatcher, events, add };
}

test('jobs work up to the worker count, and the next starts as soon as one settles', async () => {
  const { dispatcher, events, add } = setup({ workers: 1 });
  const a = add('a');
  add('b');
  await until(() => events.includes('work:a'), 'a works');
  assert.equal(dispatcher.waiting('demo/b'), 'slot');
  assert.equal(dispatcher.waiting('demo/a'), undefined, 'a works, it does not wait');
  a.finish();
  await until(() => events.includes('work:b'), 'b works after a');
});

test('a job stopped while it waits for a worker leaves the queue at once and never works', async () => {
  const { dispatcher, events, add } = setup({ workers: 1 });
  const a = add('a');
  add('b');
  await until(() => events.includes('work:a'), 'a works');
  dispatcher.stop('b');
  await dispatcher.completion('b');
  assert.deepEqual(
    events.filter((e) => e.endsWith(':b')),
    ['cancelled:b', 'settle:b'],
  );
  assert.equal(dispatcher.active('b'), false);
  a.finish();
});

test('a job behind its busy agent waits for the agent, holds no pool slot, and stops at once', async () => {
  const { pool, dispatcher, events, add } = setup({ max: 2 });
  const devin = { name: 'devin', limit: 1 };
  const a = add('a', devin);
  add('b', devin);
  await until(() => events.includes('work:a'), 'a works');
  await until(() => dispatcher.waiting('demo/b') === 'agent', 'b waits for devin');
  assert.equal(pool.inUse(), 1, 'the waiting job holds no pool slot');
  add('c');
  await until(() => events.includes('work:c'), 'another job takes the free slot');

  const started = Date.now();
  dispatcher.stop('b');
  await dispatcher.completion('b');
  assert.ok(Date.now() - started < 500, 'the stop does not wait for the next poll');
  assert.ok(events.includes('cancelled:b') && !events.includes('work:b'));
  a.finish();
});

test('release() frees the slots before the work returns, so the next job starts', async () => {
  const pool = new AgentPool({ max: 1, pollMs: 10_000 });
  const dispatcher = new Dispatcher({ workers: 2, pool, log: () => {} });
  const events: string[] = [];
  let finish!: () => void;
  dispatcher.schedule(
    {
      task: 'demo/a',
      run: 'a',
      agent: async () => undefined,
      work: async (release) => {
        release();
        await new Promise<void>((done) => (finish = done));
      },
      cancelled: async () => {},
      settle: async () => {},
    },
    dispatcher.reserve()!,
  );
  const b = job('b', events);
  dispatcher.schedule(b.spec, dispatcher.reserve()!);
  await until(() => events.includes('work:b'), 'b works while a writes its records');
  finish();
  b.finish();
});

test('slots outside the pool count, and one count serves every waiter', async () => {
  let reads = 0;
  const pool = new AgentPool({
    max: 2,
    pollMs: 10_000,
    externalTtlMs: 60_000,
    external: async () => {
      reads++;
      return 1;
    },
  });
  const first = await pool.tryAcquire();
  assert.ok(first);
  assert.equal(await pool.tryAcquire(), undefined, 'one inside and one outside fill it');
  assert.equal(reads, 1, 'the count is cached');
  first();
  assert.ok(await pool.tryAcquire(), 'a release frees a slot and reads the count again');
  assert.equal(reads, 2);
});

test('close keeps unstarted jobs unstarted, so the caller can queue them again', async () => {
  const { dispatcher, events, add } = setup({ max: 1 });
  const a = add('a');
  add('b');
  await until(() => events.includes('work:a'), 'a works');
  dispatcher.close();
  assert.equal(dispatcher.reserve(), undefined, 'no new jobs');
  a.finish();
  await dispatcher.drained();
  assert.ok(!events.includes('work:b') && !events.includes('cancelled:b'));
  assert.ok(events.includes('settle:b'));
});

test('the queue refuses jobs past its size', () => {
  const pool = new AgentPool({ max: 1 });
  const dispatcher = new Dispatcher({ workers: 1, pool, maxQueued: 1 });
  const held = dispatcher.reserve();
  assert.ok(held);
  assert.equal(dispatcher.reserve(), undefined);
  held();
  assert.ok(dispatcher.reserve());
});
