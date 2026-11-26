// Generate portable RPC and action-discovery contracts from their canonical sources: the RPC list
// (packages/backend-client/src/rpcs.ts) -> factory.proto's service block -> descriptor.json.
import { z } from 'zod';
import { format } from 'prettier';
import { TaskControls } from '../packages/core/src/task-controls.ts';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const formatting = JSON.parse(await readFile(new URL('../.prettierrc.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const protobuf = createRequire(require.resolve('@grpc/proto-loader'))('protobufjs');
import { RPCS } from '../packages/backend-client/src/rpcs.ts';

// The service block of factory.proto comes from RPCS (rpcs.ts); the messages above it stay hand-written.
const protoUrl = new URL('../packages/backend-client/factory.proto', import.meta.url);
const current = await readFile(protoUrl, 'utf8');
const start = current.indexOf('service Factory {');
if (start < 0) throw new Error('factory.proto has no `service Factory {` block');
const service = [
  'service Factory {',
  '  // Generated from packages/backend-client/src/rpcs.ts by `pnpm rpc:generate`; edit the list there.',
  ...Object.entries(RPCS).map(
    ([name, [request, response]]) => `  rpc ${name}(${request}) returns (${response});`,
  ),
  '}',
].join('\n');
const source = `${current.slice(0, start)}${service}\n`;
await writeFile(protoUrl, source);
const descriptor = protobuf.parse(source).root.toJSON();
await writeFile(
  new URL('../packages/backend-client/src/descriptor.json', import.meta.url),
  `${JSON.stringify(descriptor, null, 2)}\n`,
);

const controls = z.toJSONSchema(TaskControls);
controls.properties.task = { $ref: './task-record.schema.json' };
await writeFile(
  new URL('../resources/task-controls.schema.json', import.meta.url),
  await format(JSON.stringify(controls), { ...formatting, parser: 'json' }),
);
