// Shared foreground lifecycle for `factory serve` and `pnpm backend`.
import { startBackend } from './server.ts';
export async function serveBackend(
  root: string,
  options: { port?: number; healthPort?: number } = {},
): Promise<void> {
  const port = options.port ?? Number(process.env.FACTORY_BACKEND_PORT ?? 4319);
  const healthPort = options.healthPort ?? Number(process.env.FACTORY_HEALTH_PORT ?? 4318);
  if (![port, healthPort].every((n) => Number.isInteger(n) && n > 0 && n <= 65535))
    throw new Error('Invalid backend port');
  const server = await startBackend({ root, port, healthPort });
  process.stderr.write(
    `Factory backend: gRPC 127.0.0.1:${server.port}, health http://127.0.0.1:${server.healthPort}/health\n`,
  );
  await new Promise<void>((done, reject) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      process.stderr.write('Draining backend runs before shutdown…\n');
      server
        .close()
        .then(done, reject)
        .finally(() => {
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
        });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
