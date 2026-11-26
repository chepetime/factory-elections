import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArtifactWriter, DataStorage } from '@factory/adapters-data';
import { Evidence } from '../src/evidence.ts';

// Mirrors the remote writer: one failed upload latches, and every later append or flush rethrows it.
function storage(failures: { remaining: number }) {
  const streams: { path: string; lines: string[] }[] = [];
  const fake = {
    config: { kind: 'postgres-s3' },
    writer(path: string): ArtifactWriter {
      const stream = { path, lines: [] as string[] };
      streams.push(stream);
      let pending: string[] = [];
      let failure: unknown;
      return {
        append(text) {
          if (failure) throw failure;
          pending.push(String(text));
        },
        async flush() {
          if (failure) throw failure;
          if (!pending.length) return;
          if (failures.remaining > 0) {
            failures.remaining--;
            failure = new Error('connect ECONNREFUSED 127.0.0.1:18333');
            throw failure;
          }
          stream.lines.push(...pending);
          pending = [];
        },
      };
    },
  };
  return { storage: fake as unknown as DataStorage, streams };
}

test('a best-effort trace reports a failed write, keeps serving and records again after recovery', async () => {
  const failures = { remaining: 1 };
  const { storage: store, streams } = storage(failures);
  const errors: unknown[] = [];
  const trace = new Evidence('/root/logs/server.jsonl', 'server', store, {
    onWriteError: (error) => errors.push(error),
  });

  assert.equal(await trace.span('rpc.GetTeam', {}, async () => 'first'), 'first');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /ECONNREFUSED/);

  assert.equal(await trace.span('rpc.GetTeam', {}, async () => 'second'), 'second');
  assert.equal(errors.length, 1, 'storage is back, so no new error');
  const written = streams.flatMap((stream) => stream.lines).join('');
  assert.match(written, /"span.end"/);
  assert.ok(
    streams.some((stream) => stream.path !== '/root/logs/server.jsonl' && stream.lines.length),
    'the trace continues on a new stream',
  );
});

test('a best-effort trace still fails with the action error', async () => {
  const { storage: store } = storage({ remaining: 0 });
  const trace = new Evidence('/root/logs/server.jsonl', 'server', store, { onWriteError: () => {} });
  await assert.rejects(
    trace.span('rpc.GetTeam', {}, async () => {
      throw new Error('Project not found');
    }),
    /Project not found/,
  );
});

test('a strict trace fails with the real storage error, not an unknown Effect error', async () => {
  const { storage: store } = storage({ remaining: 1 });
  const trace = new Evidence('/root/runs/1/events.jsonl', 'run-1', store);
  await assert.rejects(
    trace.span('task.run', {}, async () => 'done'),
    /ECONNREFUSED 127\.0\.0\.1:18333/,
  );
});
