import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import { Outcome, NewOutcome, ProjectName } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';

/** Per-project outcome history, persisted in the configured document store. */
export class OutcomeStore {
  private readonly lock = Effect.runSync(Effect.makeSemaphore(1));
  private readonly root: string;
  private readonly storage: DataStorage;
  constructor(root: string, storage: DataStorage) {
    this.root = root;
    this.storage = storage;
  }
  async list(project: string): Promise<Outcome[]> {
    const path = join(this.root, ProjectName.parse(project), 'outcomes.json');
    try {
      return z.array(Outcome).parse(await this.storage.readDocument(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async add(project: string, input: unknown): Promise<Outcome> {
    return Effect.runPromise(
      this.lock.withPermits(1)(
        Effect.promise(async () => {
          const value = Outcome.parse({ ...NewOutcome.parse(input), id: randomUUID() });
          const records = await this.list(project);
          await this.storage.writeDocument(join(this.root, ProjectName.parse(project), 'outcomes.json'), [
            ...records,
            value,
          ]);
          return value;
        }),
      ),
    );
  }
}
