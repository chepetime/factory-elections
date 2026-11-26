// What a run is doing right now, for the task page: the current command, when it started, and
// when the run last printed anything. Silence is what tells "still working" apart from "stuck".
import type { ShellPort } from '@factory/driver';

import type { ActivitySnapshot } from '@factory/backend-client/protocol';

export class RunActivity {
  private readonly startedAt: string;
  private command?: { text: string; at: string };
  private lastOutput?: string;
  private readonly now: () => string;
  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
    this.startedAt = now();
  }
  /** Any log line or command output. */
  heard(): void {
    this.lastOutput = this.now();
  }
  begin(command: string): void {
    this.command = { text: command, at: this.now() };
  }
  end(): void {
    this.command = undefined;
  }
  snapshot(): ActivitySnapshot {
    return {
      run_started_at: this.startedAt,
      ...(this.command ? { command: this.command.text, command_started_at: this.command.at } : {}),
      ...(this.lastOutput ? { last_output_at: this.lastOutput } : {}),
    };
  }
}

/** The driver's shell, recording each profile command in the run's activity while it runs. */
export function trackShell(shell: ShellPort, activity: RunActivity): ShellPort {
  return {
    runShell: async (command, options) => {
      activity.begin(command);
      try {
        return await shell.runShell(command, options);
      } finally {
        activity.end();
      }
    },
  };
}
