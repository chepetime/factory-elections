// The emergency stop's switch, read and pressed through the backend.
import 'server-only';
import { backendCall } from '@factory/backend-client';
import { EmergencyStopState } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';

type Method = 'GetEmergencyStop' | 'EmergencyStop' | 'ResumeFactory';

async function call(method: Method): Promise<Result<EmergencyStopState>> {
  try {
    return { ok: true, value: EmergencyStopState.parse(JSON.parse((await backendCall(method, {})).json)) };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}

export const getEmergencyStop = () => call('GetEmergencyStop');
/** Turns the switch on and interrupts every agent the backend runs. */
export const pressEmergencyStop = () => call('EmergencyStop');
/** Turns the switch off; nothing that was interrupted restarts by itself. */
export const releaseEmergencyStop = () => call('ResumeFactory');
