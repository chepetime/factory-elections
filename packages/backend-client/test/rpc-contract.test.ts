// The RPC list has three copies: factory.proto (the source), descriptor.json (generated from it by
// `pnpm rpc:generate`) and the Methods type in protocol.ts. An RPC added to only some of them works
// until the next regeneration drops it, so the three must list the same methods.
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

test('factory.proto, descriptor.json and protocol.ts list the same RPCs', async () => {
  const proto = [...(await read('../factory.proto')).matchAll(/^\s*rpc (\w+)\(/gm)].map((m) => m[1]!).sort();
  const descriptor = descriptorMethods(JSON.parse(await read('../src/descriptor.json'))).sort();
  const protocol = [...(await read('../src/protocol.ts')).matchAll(/^ {2}([A-Z]\w+): \[/gm)]
    .map((m) => m[1]!)
    .sort();
  assert.deepEqual(descriptor, proto, 'descriptor.json differs from factory.proto: run pnpm rpc:generate');
  assert.deepEqual(protocol, proto, 'protocol.ts Methods differs from factory.proto');
});
