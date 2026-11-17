// Repeatable CLI startup measurements. Uses an isolated empty data root; no model/network calls.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const samples = Number(process.argv[2] ?? 15);
if (!Number.isInteger(samples) || samples < 3 || samples > 101)
  throw new Error('samples must be an integer between 3 and 101');
const root = await mkdtemp(join(tmpdir(), 'factory-benchmark-'));
const script = fileURLToPath(new URL('../apps/cli/src/main.ts', import.meta.url));
try {
  for (const args of [['--help'], ['project', 'list'], ['task', 'list', '--project', 'demo']]) {
    const times = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      execFileSync(process.execPath, [script, ...args], {
        env: { ...process.env, FACTORY_ROOT: root },
        stdio: 'pipe',
      });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        command: args.join(' '),
        samples,
        node: process.version,
        median_ms: times[Math.floor(samples / 2)],
        p95_ms: times[Math.ceil(samples * 0.95) - 1],
      }),
    );
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
