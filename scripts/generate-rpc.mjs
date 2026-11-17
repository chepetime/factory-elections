// Generate portable RPC and action-discovery contracts from their canonical sources.
import { z } from 'zod';
import { format } from 'prettier';
import { TaskControls } from '../packages/core/src/task-controls.ts';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const formatting = JSON.parse(await readFile(new URL('../.prettierrc.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const protobuf = createRequire(require.resolve('@grpc/proto-loader'))('protobufjs');
const source = await readFile(new URL('../packages/backend/factory.proto', import.meta.url), 'utf8');
const descriptor = protobuf.parse(source).root.toJSON();
await writeFile(
  new URL('../packages/backend/src/descriptor.json', import.meta.url),
  `${JSON.stringify(descriptor, null, 2)}\n`,
);

const controls = z.toJSONSchema(TaskControls);
controls.properties.task = { $ref: './task-record.schema.json' };
await writeFile(
  new URL('../resources/task-controls.schema.json', import.meta.url),
  await format(JSON.stringify(controls), { ...formatting, parser: 'json' }),
);
