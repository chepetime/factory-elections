import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import { NewPrReviewRecord, PrReviewRecord, ProjectName } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';

/** Project-scoped review records; writes share the backend's process lock. */
export class PrReviewStore {
  private readonly lock = Effect.runSync(Effect.makeSemaphore(1));
  private readonly root: string;
  private readonly storage: DataStorage;
  constructor(root: string, storage: DataStorage) {
    this.root = root;
    this.storage = storage;
  }
  async list(project: string): Promise<PrReviewRecord[]> {
    try {
      return z
        .array(PrReviewRecord)
        .parse(
          await this.storage.readDocument(join(this.root, ProjectName.parse(project), 'pr-reviews.json')),
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async add(project: string, input: unknown): Promise<PrReviewRecord> {
    const parsed = NewPrReviewRecord.parse(input);
    return Effect.runPromise(
      this.lock.withPermits(1)(
        Effect.promise(async () => {
          const record = PrReviewRecord.parse({ ...parsed, id: randomUUID() });
          const records = await this.list(project);
          await this.storage.writeDocument(join(this.root, ProjectName.parse(project), 'pr-reviews.json'), [
            ...records,
            record,
          ]);
          return record;
        }),
      ),
    );
  }
}
