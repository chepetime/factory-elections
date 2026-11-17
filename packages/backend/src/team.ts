// Repository contributors and assignment storage belong to the backend, never the web process.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import { aggregateLog, ProjectName } from '@factory/core';
import { storageFor, type DataStorage } from '@factory/adapters-data';

const Assignment = z.object({
  team: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
});
const TeamFile = z.object({ members: z.record(z.string(), Assignment).default({}) });

export class TeamService {
  private readonly updates = Effect.runSync(Effect.makeSemaphore(1));
  readonly root: string;
  private readonly storage: DataStorage;
  constructor(root: string) {
    this.root = root;
    this.storage = storageFor(root);
  }
  private async repo(project: string): Promise<string> {
    return (await this.storage.projects.read(ProjectName.parse(project))).repo;
  }
  private git(repo: string, args: string[]): Promise<string> {
    return new Promise((done, reject) =>
      execFile(
        'git',
        ['-C', repo, ...args],
        {
          maxBuffer: 64 * 1024 * 1024,
          timeout: 20_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        },
        (error, stdout) => (error ? reject(new Error('Could not read the repository.')) : done(stdout)),
      ),
    );
  }
  private async read(project: string) {
    try {
      return TeamFile.parse(await this.storage.readDocument(join(this.root, project, 'team.json')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { members: {} } as z.infer<typeof TeamFile>;
      throw error;
    }
  }
  async userName(project: string): Promise<string> {
    return (
      await this.git(await this.repo(project), ['config', '--get', 'user.name']).catch(() => '')
    ).trim();
  }
  async members(project: string) {
    const repo = await this.repo(project);
    const [log, { members }] = await Promise.all([
      this.git(repo, ['log', '--no-merges', '--format=%aN%x1f%aE%x1f%aI']),
      this.read(project),
    ]);
    return aggregateLog(log).map((contributor) => ({
      ...contributor,
      team: members[contributor.email]?.team,
      tags: members[contributor.email]?.tags ?? [],
    }));
  }
  async assign(raw: unknown): Promise<void> {
    const input = z
      .object({
        project: ProjectName,
        email: z
          .string()
          .trim()
          .min(3)
          .max(320)
          .refine((email) => email.includes('@'), 'Invalid member email'),
        team: z.string().optional(),
        tags: z.array(z.string()).max(12),
      })
      .parse(raw);
    await this.repo(input.project);
    const assignment = Assignment.parse({
      team: input.team?.trim() || undefined,
      tags: [...new Set(input.tags.map((tag) => tag.trim()))],
    });
    const update = Effect.tryPromise(async () => {
      const file = await this.read(input.project);
      file.members[input.email.toLowerCase()] = assignment;
      await this.storage.writeDocument(join(this.root, input.project, 'team.json'), file);
    }).pipe(this.updates.withPermits(1));
    const result = await Effect.runPromise(Effect.either(update));
    if (result._tag === 'Left') throw result.left;
  }
}
