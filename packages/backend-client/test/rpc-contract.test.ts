// The RPC list lives in rpcs.ts. `pnpm rpc:generate` writes factory.proto's service block and
// descriptor.json from it; protocol.ts derives Methods from it. This fails when a generated file is
// stale or was edited by hand.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (file: string) => readFile(new URL(file, import.meta.url), 'utf8');

function descriptorMethods(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  if (record.methods && typeof record.methods === 'object') return Object.keys(record.methods);
  return Object.values(record).flatMap(descriptorMethods);
}

test('factory.proto and descriptor.json list the RPCs of rpcs.ts, with the same messages', async () => {
  const { RPCS } = await import('../src/rpcs.ts');
  const source = await read('../factory.proto');
  const proto = Object.fromEntries(
    [...source.matchAll(/^\s*rpc (\w+)\((\w+)\) returns \((\w+)\)/gm)].map((m) => [m[1]!, [m[2]!, m[3]!]]),
  );
  assert.deepEqual(proto, RPCS, 'factory.proto differs from rpcs.ts: run pnpm rpc:generate');
  const descriptor = descriptorMethods(JSON.parse(await read('../src/descriptor.json'))).sort();
  assert.deepEqual(descriptor, Object.keys(RPCS).sort(), 'descriptor.json is stale: run pnpm rpc:generate');
});
