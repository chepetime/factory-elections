// Project settings: display name, icon, task manager and review profile. Stored as one document
// per project (Postgres when configured, else a file), so they follow the project's other records.
import { join } from 'node:path';
import { z } from 'zod';
import { ProjectName, ProjectSettings, TaskManager } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import type { ProjectStore } from '@factory/adapters-fs';
import { run } from '@factory/adapters-process';
import { Conflict } from './conflict.ts';

/** What the exploring agent proposes. Nothing is saved until the user saves the form. */
export const SettingsProposal = z.object({
  display_name: z.string().describe('A short human name for the project'),
  icon: z.string().describe('One emoji that fits the project'),
  task_manager: TaskManager,
  summary: z.string().describe('Two or three sentences: what was found and how sure you are'),
  evidence: z.array(z.string()).describe('Repository files that support the task-manager fields'),
});
export type SettingsProposal = z.infer<typeof SettingsProposal>;

const DETECT_PROMPT = `Explore this repository read-only and work out how the team tracks work, so a factory can read tasks and create tickets and epics on their behalf.

Find:
- The task manager (Jira, GitHub Issues, Linear, other, or none) and the CLI the repository documents for it (for example \`acli\` for Jira or \`gh\` for GitHub).
- The project key or board, when the repository names one.
- Exact command templates to read a ticket, list the project's open tickets, search tickets, create a ticket and create an epic. Use placeholders {key}, {query}, {summary} and {description}. Copy commands from the repository's docs, scripts, skills or agent instructions; do not invent flags.
- For listing, use the documented command that lists open tickets, with JSON output when the CLI has it, so the factory can show each ticket as a card: for \`gh\`, \`gh issue list --state open --limit 200 --json number,title,labels,state,url,assignees,author,updatedAt,comments\`; for \`acli\`, its \`--json\` flag. When there is none, use the documented search command with a query for the project's open tickets (for Jira, JQL like \`project = KEY AND statusCategory != Done ORDER BY updated DESC\`).
- The repository paths that document this usage (for example AGENTS.md, CLAUDE.md, docs/, .claude/skills/).
- Conventions worth knowing in notes: ticket key format, branch or PR title rules, required fields, epic linking.

Also propose a short display name and one emoji icon for the project.

Leave a field empty when the repository does not support it. Look at README, AGENTS.md, CLAUDE.md, CONTRIBUTING.md, docs/, .claude/, .cursor/, .github/ and scripts first.`;

export type SettingsDetector = (repo: string) => Promise<unknown>;

/** Runs Claude Code headless in the repository with read-only tools and a JSON schema. */
export const detectWithClaude: SettingsDetector = async (repo) => {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
  const result = await run(
    'claude',
    [
      '-p',
      '--model',
      'claude-sonnet-5-5',
      '--tools',
      'Read,Grep,Glob',
      '--permission-mode',
      'dontAsk',
      '--max-budget-usd',
      '2',
      '--output-format',
      'json',
      // The CLI validates the schema as draft-07; Zod's default draft-2020-12 `$schema` is rejected.
      '--json-schema',
      JSON.stringify(z.toJSONSchema(SettingsProposal, { io: 'input', target: 'draft-7' })),
      DETECT_PROMPT,
    ],
    { cwd: repo, env, timeoutMs: 600_000 },
  );
  if (result.code !== 0)
    throw new Error(
      `Exploring the repository failed: ${(result.stderr || result.stdout).trim().slice(-2000)}`,
    );
  const out = JSON.parse(result.stdout) as {
    structured_output?: unknown;
    result?: unknown;
    is_error?: boolean;
  };
  if (out.is_error) throw new Error(`Exploring the repository failed: ${String(out.result ?? '')}`);
  return out.structured_output ?? (typeof out.result === 'string' ? JSON.parse(out.result) : out.result);
};

export class ProjectSettingsService {
  private readonly root: string;
  private readonly storage: DataStorage;
  private readonly projects: ProjectStore;
  private readonly detector: SettingsDetector;
  constructor(
    root: string,
    storage: DataStorage,
    projects: ProjectStore,
    detector: SettingsDetector = detectWithClaude,
  ) {
    this.root = root;
    this.storage = storage;
    this.projects = projects;
    this.detector = detector;
  }
  private path(project: string): string {
    return join(this.root, project, 'settings.json');
  }
  async get(project: string): Promise<ProjectSettings> {
    ProjectName.parse(project);
    try {
      return ProjectSettings.parse(await this.storage.readDocument(this.path(project)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ProjectSettings.parse({});
      throw error;
    }
  }
  async save(raw: unknown): Promise<ProjectSettings> {
    const { project, json } = z.object({ project: ProjectName, json: z.string().max(200_000) }).parse(raw);
    await this.projects.read(project);
    const settings = ProjectSettings.parse({ ...JSON.parse(json), updated_at: new Date().toISOString() });
    // Empty strings mean "not set"; store them as absent.
    const clean = JSON.parse(JSON.stringify(settings, (_k, v: unknown) => (v === '' ? undefined : v)));
    await this.storage.writeDocument(this.path(project), clean);
    return ProjectSettings.parse(clean);
  }
  async detect(raw: unknown): Promise<SettingsProposal> {
    const { project } = z.object({ project: ProjectName }).parse(raw);
    const { repo } = await this.projects.read(project);
    const proposal = SettingsProposal.safeParse(await this.detector(repo));
    if (!proposal.success)
      throw new Conflict('The exploring agent returned an unexpected answer; try again.');
    return proposal.data;
  }
}
