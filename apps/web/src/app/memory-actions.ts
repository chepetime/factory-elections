'use server';
import { revalidatePath } from 'next/cache';
import { isProjectName } from '@/lib/factory';
import { forgetFact, restorePrunedTools } from '@/lib/memory';

export type MemoryActionResult = { error?: string };

export async function forgetFactAction(project: string, id: string): Promise<MemoryActionResult> {
  if (!isProjectName(project) || !id) return { error: 'Invalid project or fact.' };
  const result = await forgetFact(project, id);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/projects/${project}/memory`);
  return {};
}

export async function restoreToolsAction(project: string): Promise<MemoryActionResult> {
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await restorePrunedTools(project);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/projects/${project}/memory`);
  return {};
}
