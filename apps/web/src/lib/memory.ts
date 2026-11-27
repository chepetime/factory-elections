// What the factory remembers about a project: its facts, the sessions that show them, and the tools
// review turns no longer get. Reads and removals go through the GetMemory, ForgetFact and RestoreTools RPCs.
import 'server-only';
import { backendCall } from '@factory/backend-client';
import { MemorySnapshot } from '@factory/core';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getMemory(project: string): Promise<Result<MemorySnapshot>> {
  return attempt(async () =>
    MemorySnapshot.parse(JSON.parse((await backendCall('GetMemory', { project, id: '' })).json)),
  );
}

/** Marks the fact dropped; the backend keeps it so a later review cannot propose it again. */
export function forgetFact(project: string, id: string): Promise<Result<void>> {
  return attempt(async () => void (await backendCall('ForgetFact', { project, id })));
}

export function restorePrunedTools(project: string): Promise<Result<void>> {
  return attempt(async () => void (await backendCall('RestoreTools', { project, id: '' })));
}
