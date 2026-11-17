// Generate a portable descriptor: Next.js needs no runtime filesystem path to the .proto file.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const protobuf = createRequire(require.resolve('@grpc/proto-loader'))('protobufjs');
const source = await readFile(new URL('../packages/backend/factory.proto', import.meta.url), 'utf8');
const descriptor = protobuf.parse(source).root.toJSON();
await writeFile(
  new URL('../packages/backend/src/descriptor.json', import.meta.url),
  `${JSON.stringify(descriptor, null, 2)}\n`,
);
