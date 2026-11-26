import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Effect, Semaphore } from 'effect';
import { z } from 'zod';
import { Experiment, NewExperiment, ProjectName } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';

/** Per-project change history, persisted in the configured document store. */
export class ExperimentStore {
  private readonly lock = Effect.runSync(Semaphore.make(1));
  private readonly root: string;
  private readonly storage: DataStorage;
  constructor(root: string, storage: DataStorage) {
    this.root = root;
    this.storage = storage;
  }
  async list(project: string): Promise<Experiment[]> {
    const path = join(this.root, ProjectName.parse(project), 'experiments.json');
    try {
      return z.array(Experiment).parse(await this.storage.readDocument(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async add(project: string, input: unknown): Promise<Experiment> {
    return Effect.runPromise(
      this.lock.withPermits(1)(
        Effect.promise(async () => {
          const value = Experiment.parse({ ...NewExperiment.parse(input), id: randomUUID() });
          const records = await this.list(project);
          await this.storage.writeDocument(join(this.root, ProjectName.parse(project), 'experiments.json'), [
            ...records,
            value,
          ]);
          return value;
        }),
      ),
    );
  }
}
