'use server';
import { revalidatePath } from 'next/cache';
import { isProjectName } from '@/lib/factory';
import { updateMembers, type MemberUpdate, type TeamMember } from '@/lib/team';

export async function updateTeamMembers(
  project: string,
  update: MemberUpdate,
): Promise<{ error?: string; members?: TeamMember[] }> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await updateMembers(project, update);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/projects/${project}/team`);
  return { members: result.value };
}
