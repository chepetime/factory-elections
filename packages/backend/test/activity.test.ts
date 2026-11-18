import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunActivity, trackShell } from '../src/activity.ts';

test('the tracked shell records the current command and its start, and clears it when it ends', async () => {
  let time = 1_000;
  const activity = new RunActivity(() => new Date(time).toISOString());
  let release!: () => void;
  const shell = trackShell(
    {
      runShell: (_command, options) =>
        new Promise((done) => {
          options.onOutput?.('line\n');
          release = () => done({ code: 0, stdout: '', stderr: '' });
        }),
    },
    activity,
  );
  const running = shell.runShell('pnpm install', { cwd: '/w' });
  assert.deepEqual(activity.snapshot(), {
    run_started_at: new Date(1_000).toISOString(),
    command: 'pnpm install',
    command_started_at: new Date(1_000).toISOString(),
  });
  time = 5_000;
  activity.heard();
  assert.equal(activity.snapshot().last_output_at, new Date(5_000).toISOString());
  release();
  await running;
  assert.equal(activity.snapshot().command, undefined, 'no command after it ends');
});
