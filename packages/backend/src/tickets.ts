import { z } from 'zod';
import { parseTickets, ProjectName, type ProjectSettings } from '@factory/core';
import type { ProjectStore } from '@factory/adapters-fs';
import { runShell } from '@factory/adapters-process';

/** Executes the project's configured listing command in its registered repository. */
export class TicketService {
  private readonly projects: ProjectStore;
  private readonly settings: (project: string) => Promise<ProjectSettings>;
  private readonly execute: typeof runShell;

  constructor(
    projects: ProjectStore,
    settings: (project: string) => Promise<ProjectSettings>,
    execute: typeof runShell = runShell,
  ) {
    this.projects = projects;
    this.settings = settings;
    this.execute = execute;
  }

  async list(raw: unknown) {
    const { project } = z.object({ project: ProjectName }).parse(raw);
    const { repo } = await this.projects.read(project);
    const { task_manager: manager } = await this.settings(project);
    const command = manager.list_tickets?.trim();
    if (manager.kind === 'none' || !command) return { configured: false, text: '' };
    const result = await this.execute(command, {
      cwd: repo,
      timeoutMs: 45_000,
      captureLimit: 500_000,
      group: true,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', CI: '1' },
    });
    if (result.stopped) throw new Error('Loading tickets timed out. Try refreshing.');
    if (result.code !== 0)
      throw new Error(
        `Could not load tickets: ${(result.stderr || result.stdout).trim().slice(-2000) || `command exited with code ${result.code}`}`,
      );
    const text = result.stdout.trim();
    // JSON tickets become cards on the Remote Tickets page; any other output shows as text.
    const parsed = parseTickets(text);
    // GitHub output lists `number` without `url` unless asked: link it through the project's repo.
    const repoKey = manager.kind === 'github' ? manager.project_key?.trim() : undefined;
    const tickets =
      parsed && repoKey && /^[\w.-]+\/[\w.-]+$/.test(repoKey)
        ? parsed.map((t) =>
            t.url || !/^#\d+$/.test(t.key)
              ? t
              : { ...t, url: `https://github.com/${repoKey}/issues/${t.key.slice(1)}` },
          )
        : parsed;
    return { configured: true, text, ...(tickets ? { tickets } : {}) };
  }
}
