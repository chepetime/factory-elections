'use server';
import { revalidatePath } from 'next/cache';
import type { EmergencyStopState } from '@factory/core';
import { pressEmergencyStop, releaseEmergencyStop } from '@/lib/emergency-stop';

export type EmergencyActionState = { state?: EmergencyStopState; error?: string };

/** Stops every agent and holds new work until `resumeFactory`. */
export async function emergencyStop(): Promise<EmergencyActionState> {
  const result = await pressEmergencyStop();
  revalidatePath('/', 'layout');
  return result.ok ? { state: result.value } : { error: result.error };
}

export async function resumeFactory(): Promise<EmergencyActionState> {
  const result = await releaseEmergencyStop();
  revalidatePath('/', 'layout');
  return result.ok ? { state: result.value } : { error: result.error };
}
