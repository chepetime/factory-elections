// Server-only typed bridge. Repository access and assignment persistence belong to the backend.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import type { Contributor } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';
export type { Contributor };

const TeamMember = z.object({
  email: z.string(),
  aliases: z.array(z.string()).optional(),
  name: z.string(),
  commits: z.number().int().nonnegative(),
  firstCommit: z.string(),
  lastCommit: z.string(),
  team: z.string().optional(),
  tags: z.array(z.string()),
});
export type TeamMember = z.infer<typeof TeamMember>;

export async function gitUserName(project: string): Promise<string | undefined> {
  try {
    return (await backendCall('GetGitUser', { project })).text || undefined;
  } catch {
    return undefined;
  }
}
export async function teamMembers(project: string): Promise<Result<TeamMember[]>> {
  try {
    return {
      ok: true,
      value: z.array(TeamMember).parse(JSON.parse((await backendCall('GetTeam', { project })).json)),
    };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
export async function saveAssignment(
  project: string,
  email: string,
  team: string | undefined,
  tags: string[],
): Promise<Result<null>> {
  try {
    await backendCall('SaveAssignment', { project, email, team, tags });
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}

export type MemberUpdate =
  | { kind: 'edit'; emails: string[]; team?: string; tags?: string[] }
  | { kind: 'merge'; emails: string[]; primary: string };

export async function updateMembers(project: string, update: MemberUpdate): Promise<Result<TeamMember[]>> {
  try {
    const response = await backendCall('UpdateMembers', { project, json: JSON.stringify(update) }, 60_000);
    return { ok: true, value: z.array(TeamMember).parse(JSON.parse(response.json)) };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
