import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/index.ts';

test('large output keeps a bounded tail while streaming every character', async () => {
  let streamed = 0;
  const result = await run(
    process.execPath,
    [
      '-e',
      `
    process.stdout.write('x'.repeat(2_000_000) + 'stdout-end');
    process.stderr.write('y'.repeat(2_000_000) + 'stderr-end');
  `,
    ],
    {
      captureLimit: 100,
      onOutput: (chunk) => {
        streamed += chunk.length;
      },
    },
  );
  assert.equal(result.code, 0);
  assert.equal(streamed, 4_000_020);
  assert.equal(result.stdout.length, 100);
  assert.equal(result.stderr.length, 100);
  assert.ok(result.stdout.endsWith('stdout-end'));
  assert.ok(result.stderr.endsWith('stderr-end'));
});

test('zero capture streams output and default capture preserves full output', async () => {
  let streamed = '';
  const result = await run(process.execPath, ['-e', "process.stdout.write('hello')"], {
    captureLimit: 0,
    onOutput: (chunk) => {
      streamed += chunk;
    },
  });
  assert.equal(result.stdout, '');
  assert.equal(streamed, 'hello');
  assert.equal((await run(process.execPath, ['-e', "process.stdout.write('hello')"])).stdout, 'hello');
});

test('UTF-8 characters split across writes decode correctly', async () => {
  const result = await run(process.execPath, [
    '-e',
    `
    const bytes = Buffer.from('🌍');
    process.stdout.write(bytes.subarray(0, 2));
    setTimeout(() => process.stdout.write(bytes.subarray(2)), 20);
  `,
  ]);
  assert.equal(result.stdout, '🌍');
});

test('spawn failure and a child closing stdin do not crash the caller', async () => {
  assert.equal((await run('/nonexistent/factory-command', [])).code, 127);
  const result = await run(process.execPath, ['-e', 'process.exit(0)'], { input: 'x'.repeat(2_000_000) });
  assert.equal(result.code, 0);
});

test('a group run stops the shell and the processes it started on a timeout', async () => {
  // The shell starts a long sleep in the background and waits; killing only /bin/sh would leave it.
  const started = Date.now();
  // The limit leaves the shell time to print its child's PID on a loaded machine.
  const result = await run('/bin/sh', ['-c', 'sleep 30 & echo $! ; wait'], { timeoutMs: 1500, group: true });
  assert.equal(result.stopped, 'timeout');
  assert.ok(Date.now() - started < 10_000);
  const child = Number(result.stdout.trim());
  assert.ok(child > 0);
  const gone = () => {
    try {
      process.kill(child, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  };
  for (let i = 0; i < 50 && !gone(); i++) await new Promise((done) => setTimeout(done, 100));
  assert.ok(gone(), 'the background child was stopped with the group');
});

test('an aborted run stops at once and says why', async () => {
  const controller = new AbortController();
  const running = run('/bin/sh', ['-c', 'sleep 30'], { signal: controller.signal, group: true });
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assert.equal(result.stopped, 'aborted');
  const already = await run('/bin/sh', ['-c', 'sleep 30'], { signal: AbortSignal.abort(), group: true });
  assert.equal(already.stopped, 'aborted');
});

test('a command that prints nothing for the stall limit is stopped as stalled; output resets the limit', async () => {
  const quiet = await run('/bin/sh', ['-c', 'echo started; sleep 30'], { stallMs: 1000, group: true });
  assert.equal(quiet.stopped, 'stalled');
  assert.match(quiet.stdout, /started/);
  // Output every 0.2 s keeps resetting a 3 s limit; together the run lasts longer than the limit.
  const chatty = await run('/bin/sh', ['-c', 'for i in $(seq 1 20); do echo $i; sleep 0.2; done'], {
    stallMs: 3000,
  });
  assert.equal(chatty.stopped, undefined);
  assert.equal(chatty.code, 0);
});

test('stdout and stderr callbacks each get only their own stream', async () => {
  let out = '';
  let err = '';
  let both = '';
  await run(process.execPath, ['-e', "process.stdout.write('o'); process.stderr.write('e')"], {
    onStdout: (c) => (out += c),
    onStderr: (c) => (err += c),
    onOutput: (c) => (both += c),
  });
  assert.equal(out, 'o');
  assert.equal(err, 'e');
  assert.equal([...both].sort().join(''), 'eo');
});
