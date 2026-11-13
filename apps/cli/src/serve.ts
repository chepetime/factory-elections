// Local engine health API (resources/engine-health.openapi.yaml), bound to 127.0.0.1 only.
import { createServer } from 'node:http';
import { isReadableDirectory } from '@factory/adapters-fs';

export async function healthBody(root: string) {
  return {
    engine: 'running',
    task_store: await isReadableDirectory(root),
    telemetry_database: 'not_configured',
    integrations: [],
  };
}

export function serveHealth(root: string, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(await healthBody(root)));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_found"}');
    });
    server.once('error', (error) =>
      reject(new Error(`cannot listen on 127.0.0.1:${port}: ${error.message}`)),
    );
    server.listen(port, '127.0.0.1', () => {
      process.stderr.write(`Engine health on http://127.0.0.1:${port}/health\n`);
      const stop = () => server.close(() => resolvePromise());
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  });
}
