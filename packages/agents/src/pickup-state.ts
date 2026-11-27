// What pickup remembers across restarts: when a task last failed to start and which tasks the
// coordinator found no agent for. One small document, never part of the task record the board edits.
import { join } from 'node:path';
import { z } from 'zod';
import type { DataStorage } from '@factory/adapters-data';
import { WORKSPACE_DIR } from './agent-profiles.ts';

export const PickupState = z.object({
  /** "<project>/<key>" → the time of the last failed start and how many failed in a row. */
  retry: z.record(z.string(), z.object({ at: z.string(), failures: z.number().int().min(1) })).default({}),
  /** "<project>/<key>" → the task's `updated_at` when the coordinator found no agent for it. */
  unrouted: z.record(z.string(), z.string()).default({}),
});
export type PickupState = z.infer<typeof PickupState>;

/** Where pickup keeps its state. `load` resolves undefined when nothing is stored yet. */
export type PickupStateStore = {
  load(): Promise<PickupState | undefined>;
  save(state: PickupState): Promise<void>;
};

/** The default: remembers nothing across instances. */
export function memoryPickupState(): PickupStateStore {
  let kept: PickupState | undefined;
  return {
    load: async () => kept,
    save: async (state) => void (kept = structuredClone(state)),
  };
}

/** `<root>/.workspace/pickup.json`; the workspace folder cannot clash with a project name. */
export function documentPickupState(
  root: string,
  storage: Pick<DataStorage, 'readDocument' | 'writeDocument'>,
): PickupStateStore {
  const path = join(root, WORKSPACE_DIR, 'pickup.json');
  return {
    async load() {
      try {
        return PickupState.parse(await storage.readDocument(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    save: (state) => storage.writeDocument(path, state),
  };
}
