// Server-only: the people who committed to a project's repository, plus the team and tags you
// gave them. Contributors come from `git log`; assignments live in <data root>/<project>/team.json.
import 'server-only';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { dataRoot, listProjects, type Result } from '@/lib/factory';
import { aggregateLog, type Contributor } from '@/lib/team-log';

export type { Contributor };

const Assignment = z.object({
  team: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
});
const TeamFile = z.object({ members: z.record(z.string(), Assignment).default({}) });
type TeamFile = z.infer<typeof TeamFile>;

export interface TeamMember extends Contributor {
  team?: string;
  tags: string[];
}

function git(repo: string, args: string[]): Promise<string | undefined> {
  return new Promise((done) =>
    execFile(
      'git',
      ['-C', repo, ...args],
      { maxBuffer: 64 * 1024 * 1024, timeout: 20_000 },
      (error, stdout) => done(error ? undefined : stdout),
    ),
  );
}

async function repoOf(project: string): Promise<string | undefined> {
  const projects = await listProjects();
  return projects.ok ? projects.value.find((p) => p.name === project)?.repo : undefined;
}

/** Your git user name in the project's repository, for the greeting. */
export async function gitUserName(project: string): Promise<string | undefined> {
  const repo = await repoOf(project);
  const name = repo ? (await git(repo, ['config', 'user.name']))?.trim() : undefined;
  return name || undefined;
}

function teamPath(project: string): string {
  return join(dataRoot(), project, 'team.json');
}

function readTeam(project: string): TeamFile {
  try {
    const parsed = TeamFile.safeParse(JSON.parse(readFileSync(teamPath(project), 'utf8')));
    return parsed.success ? parsed.data : { members: {} };
  } catch {
    return { members: {} };
  }
}

export async function teamMembers(project: string): Promise<Result<TeamMember[]>> {
  const repo = await repoOf(project);
  if (!repo) return { ok: false, error: 'Project not found.' };
  const log = await git(repo, ['log', '--no-merges', '--format=%aN%x1f%aE%x1f%aI']);
  if (log === undefined) return { ok: false, error: 'Could not read the git history.' };
  const { members } = readTeam(project);
  return {
    ok: true,
    value: aggregateLog(log).map((c) => ({
      ...c,
      team: members[c.email]?.team,
      tags: members[c.email]?.tags ?? [],
    })),
  };
}

/** Sets one member's team and tags. Empty team clears it. */
export function saveAssignment(
  project: string,
  email: string,
  team: string | undefined,
  tags: string[],
): Result<null> {
  const parsed = Assignment.safeParse({
    team: team?.trim() || undefined,
    tags: [...new Set(tags.map((t) => t.trim()))],
  });
  if (!parsed.success)
    return { ok: false, error: 'Team names are up to 40 characters, tags up to 30 (12 at most).' };
  const file = readTeam(project);
  file.members[email.toLowerCase()] = parsed.data;
  const path = teamPath(project);
  mkdirSync(join(dataRoot(), project), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return { ok: true, value: null };
}
