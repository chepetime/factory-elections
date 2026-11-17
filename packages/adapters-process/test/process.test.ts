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
