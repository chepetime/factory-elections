import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelRun } from '@factory/core';

export async function piHome(request: ModelRun) {
  const home = await mkdtemp(join(tmpdir(), 'factory-pi-'));
  const original = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  try {
    for (const file of ['auth.json', 'models.json']) await symlink(join(original, file), join(home, file));
    if (request.mcp) {
      await writeFile(
        join(home, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            factory: {
              url: request.mcp.url,
              headers: { Authorization: 'Bearer ${FACTORY_PI_TOKEN}' },
              exposure: 'direct',
            },
          },
        }),
        { mode: 0o600 },
      );
    }
    return home;
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

export async function piSessionArgs(request: ModelRun): Promise<string[]> {
  if (!request.resume && !request.persistSession) return ['--no-session'];
  if (request.resume && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.resume))
    throw new Error('Invalid Pi session ID.');
  const key = createHash('sha256')
    .update(request.cwd ?? process.cwd())
    .digest('hex');
  const sessionDir = join(homedir(), '.pi', 'factory-sessions', key);
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  return ['--session-dir', sessionDir, ...(request.resume ? ['--session', request.resume] : [])];
}
