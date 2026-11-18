// Repository contributors and assignment storage belong to the backend, never the web process.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import { aggregateLog, ProjectName, TeamMember, TeamMemberInput, type Contributor } from '@factory/core';
import { storageFor, type DataStorage } from '@factory/adapters-data';

const Assignment = z.object({
  team: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
});
const Email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .refine((email) => email.includes('@'), 'Invalid member email');
const TeamFile = z.object({
  members: z.record(z.string(), Assignment).default({}),
  aliases: z.record(z.string(), Email).default({}),
  records: z.array(TeamMember).default([]),
});
type TeamFile = z.infer<typeof TeamFile>;
const BulkUpdate = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('edit'),
      emails: z.array(Email).min(1).max(500),
      team: z.string().max(40).optional(),
      tags: z.array(z.string()).max(12).optional(),
    })
    .refine((value) => value.team !== undefined || value.tags !== undefined, 'Choose a field to update'),
  z.object({ kind: z.literal('merge'), emails: z.array(Email).min(2).max(500), primary: Email }),
]);

function rows(contributors: Contributor[], file: TeamFile) {
  const combined = new Map<string, Contributor & { aliases: string[] }>();
  for (const contributor of contributors) {
    const email = file.aliases[contributor.email] ?? contributor.email;
    const existing = combined.get(email);
    if (!existing) combined.set(email, { ...contributor, email, aliases: [] });
    else {
      existing.commits += contributor.commits;
      if (Date.parse(contributor.firstCommit) < Date.parse(existing.firstCommit))
        existing.firstCommit = contributor.firstCommit;
      if (Date.parse(contributor.lastCommit) > Date.parse(existing.lastCommit))
        existing.lastCommit = contributor.lastCommit;
    }
  }
  for (const member of combined.values()) {
    member.name = contributors.find((c) => c.email === member.email)?.name ?? member.name;
    member.aliases = Object.entries(file.aliases)
      .filter(([, primary]) => primary === member.email)
      .map(([alias]) => alias)
      .sort();
  }
  return [...combined.values()]
    .map((member) => ({
      ...member,
      team: file.members[member.email]?.team,
      tags: file.members[member.email]?.tags ?? [],
    }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return TeamFile.parse({});
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
    const [log, file] = await Promise.all([
      this.git(repo, ['log', '--no-merges', '--format=%aN%x1f%aE%x1f%aI']),
      this.read(project),
    ]);
    return rows(aggregateLog(log), file);
  }
  async records(project: string): Promise<TeamMember[]> {
    await this.repo(project);
    return (await this.read(project)).records;
  }
  async saveRecord(project: string, input: unknown): Promise<TeamMember> {
    await this.repo(project);
    const parsed = TeamMemberInput.parse(input);
    const update = Effect.tryPromise({
      try: async () => {
        const file = await this.read(project);
        if (parsed.id && !file.records.some((record) => record.id === parsed.id))
          throw new Error('Team member not found');
        if (
          file.records.some(
            (record) =>
              record.id !== parsed.id &&
              (record.jira_id === parsed.jira_id ||
                record.github_login.toLowerCase() === parsed.github_login.toLowerCase()),
          )
        )
          throw new Error('Jira or GitHub identity already belongs to a team member');
        const member = TeamMember.parse({ ...parsed, id: parsed.id ?? randomUUID() });
        file.records = [...file.records.filter((record) => record.id !== member.id), member];
        await this.storage.writeDocument(join(this.root, project, 'team.json'), file);
        return member;
      },
      catch: (error) => error,
    }).pipe(this.updates.withPermits(1));
    const result = await Effect.runPromise(Effect.either(update));
    if (result._tag === 'Left') throw result.left;
    return result.right;
  }
  /** Applies one atomic edit or identity merge, serialized with individual assignments. */
  async bulk(raw: unknown) {
    const { project, json } = z.object({ project: ProjectName, json: z.string().max(200_000) }).parse(raw);
    const input = BulkUpdate.parse(JSON.parse(json));
    const repo = await this.repo(project);
    const update = Effect.tryPromise({
      try: async () => {
        const [log, file] = await Promise.all([
          this.git(repo, ['log', '--no-merges', '--format=%aN%x1f%aE%x1f%aI']),
          this.read(project),
        ]);
        const contributors = aggregateLog(log);
        const current = rows(contributors, file);
        const emails = [...new Set(input.emails)];
        if (emails.some((email) => !current.some((member) => member.email === email)))
          throw new Error('The selected members changed. Reload the page and select them again.');
        if (input.kind === 'edit') {
          for (const email of emails) {
            const before = file.members[email] ?? { tags: [] };
            file.members[email] = Assignment.parse({
              team: input.team === undefined ? before.team : input.team.trim() || undefined,
              tags:
                input.tags === undefined ? before.tags : [...new Set(input.tags.map((tag) => tag.trim()))],
            });
          }
        } else {
          if (emails.length < 2 || !emails.includes(input.primary))
            throw new Error('Choose at least two members and an identity to keep.');
          const selected = current.filter((member) => emails.includes(member.email));
          const primary = selected.find((member) => member.email === input.primary)!;
          const tags = [...new Set(selected.flatMap((member) => member.tags))];
          if (tags.length > 12)
            throw new Error(
              'These members have more than 12 combined tags. Remove some tags before merging.',
            );
          file.members[input.primary] = Assignment.parse({ team: primary.team, tags });
          for (const [alias, target] of Object.entries(file.aliases)) {
            if (emails.includes(target)) file.aliases[alias] = input.primary;
          }
          for (const email of emails) {
            if (email === input.primary) continue;
            file.aliases[email] = input.primary;
            delete file.members[email];
          }
        }
        await this.storage.writeDocument(join(this.root, project, 'team.json'), file);
        return rows(contributors, file);
      },
      catch: (error) => error,
    }).pipe(this.updates.withPermits(1));
    const result = await Effect.runPromise(Effect.either(update));
    if (result._tag === 'Left') throw result.left;
    return result.right;
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
    const update = Effect.tryPromise({
      try: async () => {
        const file = await this.read(input.project);
        const email = input.email.toLowerCase();
        file.members[file.aliases[email] ?? email] = assignment;
        await this.storage.writeDocument(join(this.root, input.project, 'team.json'), file);
      },
      catch: (error) => error,
    }).pipe(this.updates.withPermits(1));
    const result = await Effect.runPromise(Effect.either(update));
    if (result._tag === 'Left') throw result.left;
  }
}
