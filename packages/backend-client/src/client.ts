// Server-side client only. One persistent channel per endpoint; never falls back to CLI execution.
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { definition, type Methods } from './protocol.ts';

// Survives Next.js development module reloads without opening abandoned channels.
const channels = globalThis as typeof globalThis & {
  factoryBackendChannel?: { address: string; client: Client };
};
export function closeBackendClient(): void {
  channels.factoryBackendChannel?.client.close();
  channels.factoryBackendChannel = undefined;
}
export async function backendCall<K extends keyof Methods>(
  method: K,
  request: Methods[K][0],
  timeoutMs = 10_000,
): Promise<Methods[K][1]> {
  const address =
    process.env.FACTORY_BACKEND_ADDRESS ?? `127.0.0.1:${process.env.FACTORY_BACKEND_PORT ?? 4319}`;
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Backend must use a local loopback address');
  if (channels.factoryBackendChannel?.address !== address) {
    closeBackendClient();
    channels.factoryBackendChannel = {
      address,
      client: new Client(address, credentials.createInsecure(), {
        'grpc.max_receive_message_length': 16 * 1024 * 1024,
      }),
    };
  }
  const client = channels.factoryBackendChannel!.client;
  const root = process.env.FACTORY_ROOT
    ? resolve(process.env.FACTORY_ROOT)
    : join(homedir(), '.local/share/factory');
  const token =
    process.env.FACTORY_BACKEND_TOKEN ?? (await readFile(join(root, 'backend-token'), 'utf8')).trim();
  const metadata = new Metadata();
  metadata.set('authorization', `Bearer ${token}`);
  const rpc = definition[method]!;
  return new Promise((done, reject) => {
    client.makeUnaryRequest(
      rpc.path,
      rpc.requestSerialize,
      rpc.responseDeserialize,
      request,
      metadata,
      { deadline: Date.now() + timeoutMs },
      (error, value) => (error ? reject(error) : done(value as Methods[K][1])),
    );
  });
}
