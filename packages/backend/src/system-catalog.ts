// What the factory gives its agents, for the System pages: the MCP servers a turn can reach, the
// tools (factory tools on the factory MCP server and the provider's built-in tools), and the
// skills (the factory's own and each project repo's). Read-only; it starts nothing.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpanRecord, ToolAccess } from '@factory/core';
import { chatTools, taskTools } from '@factory/agents';
import { CLAUDE_TOOL_ACCESS } from '@factory/adapters-claude';

const FACTORY_SKILLS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'definitions',
  'skills',
);
/** Where a repo keeps its agent skills; the first that exists wins per skill name. */
const REPO_SKILL_DIRS = ['.claude/skills', '.codex/skills', '.agents/skills'];
const USAGE_DAYS = 14;

export interface CatalogTool {
  name: string;
  description: string;
  /** Where the tool comes from: the factory MCP server, or the provider's built-in set. */
  source: 'factory' | 'built-in';
  /** For factory tools: when an agent gets it. For built-in tools: the access levels that allow it. */
  when: string;
  /** Calls and failed calls over the last `usage_days` days, from the span ledger. */
  calls: number;
  failed: number;
}

export interface CatalogSkill {
  name: string;
  description: string;
  /** `factory` for the factory's own skills; otherwise the project whose repo holds it. */
  owner: string;
  path: string;
  version?: string;
}

export interface CatalogMcpServer {
  name: string;
  transport: string;
  description: string;
  tools: string[];
}

export interface SystemCatalog {
  usage_days: number;
  mcp: CatalogMcpServer[];
  /** MCP servers of the agent's own, beyond the factory server. None are configured today. */
  external_mcp: { name: string; url: string }[];
  tools: CatalogTool[];
  skills: CatalogSkill[];
}

export interface CatalogDeps {
  projects: { list(): Promise<{ name: string; repo: string }[]> };
  traces: { read(project: string, filter?: { since?: string }): Promise<SpanRecord[]> };
  /** The factory skills directory; tests point it elsewhere. */
  factorySkills?: string;
}

const DELEGATE = {
  name: 'delegate',
  description:
    'Start a child task on another agent (claude or codex) and wait for its final answer. The child counts against the agent limit and the budget.',
};

/** Name and description of each factory tool. The builders need ports; none is called here. */
function factoryTools(): { name: string; description: string; when: string }[] {
  const unused = () => Promise.reject(new Error('catalog only'));
  const board = { comment: unused, setStatus: unused, create: unused, update: unused, list: unused };
  const agent = { id: 'catalog', name: 'Catalog' };
  const task = taskTools({ issues: board, project: 'catalog', key: 'X-1', agent, report: {} });
  const chat = chatTools({ issues: board, projects: async () => [], agent, onCreated: () => {} });
  return [
    { ...DELEGATE, when: 'Turns that may start child tasks' },
    ...task.map((t) => ({ name: t.name, description: t.description, when: 'An agent working a task' })),
    ...chat.map((t) => ({ name: t.name, description: t.description, when: 'An agent in a chat' })),
  ];
}

const BUILT_IN: Record<string, string> = {
  Read: 'Read a file.',
  Grep: 'Search file contents.',
  Glob: 'Find files by name pattern.',
  Edit: 'Change part of a file.',
  Write: 'Write a whole file.',
  Bash: 'Run a shell command, inside the sandbox.',
  Agent: 'Hand part of the work to a subagent, under the same guard and budget.',
};

/** The name a tool span records for a factory tool: `mcp__factory__comment` or plain `comment`. */
const spanToolName = (name: string) => name.replace(/^mcp__factory__/, '');

/** `name`, `description` and `version` from a SKILL.md front matter. */
export function skillFrontMatter(text: string): { name?: string; description?: string; version?: string } {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
  if (!block) return {};
  const field = (key: string) => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block)?.[1]?.trim();
    return line ? line.replace(/^(['"])(.*)\1$/, '$2') : undefined;
  };
  const out: { name?: string; description?: string; version?: string } = {};
  for (const key of ['name', 'description', 'version'] as const) {
    const value = field(key);
    if (value) out[key] = value;
  }
  return out;
}

async function skillsIn(dir: string, owner: string): Promise<CatalogSkill[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const path = join(dir, e.name, 'SKILL.md');
        const text = await readFile(path, 'utf8').catch(() => undefined);
        if (text === undefined) return undefined;
        const meta = skillFrontMatter(text);
        return {
          name: meta.name ?? e.name,
          description: meta.description ?? '',
          owner,
          path,
          ...(meta.version ? { version: meta.version } : {}),
        };
      }),
  );
  return skills.filter((s): s is CatalogSkill => !!s);
}

export async function systemCatalog(deps: CatalogDeps): Promise<SystemCatalog> {
  const projects = await deps.projects.list();
  const since = new Date(Date.now() - USAGE_DAYS * 86_400_000).toISOString();
  const spans = (
    await Promise.all(projects.map((p) => deps.traces.read(p.name, { since }).catch(() => [])))
  ).flat();
  const usage = new Map<string, { calls: number; failed: number }>();
  for (const span of spans) {
    if (span.type !== 'tool') continue;
    const name = spanToolName(span.name);
    const u = usage.get(name) ?? { calls: 0, failed: 0 };
    u.calls++;
    if (span.outcome !== 'completed') u.failed++;
    usage.set(name, u);
  }
  const used = (name: string) => usage.get(name) ?? { calls: 0, failed: 0 };

  const factory = factoryTools();
  const levels = (name: string) =>
    (Object.entries(CLAUDE_TOOL_ACCESS) as [ToolAccess, string[]][])
      .filter(([, tools]) => tools.includes(name))
      .map(([level]) => level);
  const builtIn = Object.entries(BUILT_IN).map(([name, description]) => ({
    name,
    description,
    source: 'built-in' as const,
    when: `Steps with ${levels(name).join(' or ')} access`,
    ...used(name),
  }));

  const repoSkills = await Promise.all(
    projects.map(async (p) => {
      const found = (await Promise.all(REPO_SKILL_DIRS.map((d) => skillsIn(join(p.repo, d), p.name)))).flat();
      const seen = new Set<string>();
      return found.filter((s) => !seen.has(s.name) && seen.add(s.name));
    }),
  );

  return {
    usage_days: USAGE_DAYS,
    mcp: [
      {
        name: 'factory',
        transport: 'HTTP on this backend, one token per turn',
        description:
          'Serves the factory tools to agent turns. Each grant lists only the tools that turn may call, and ends with the turn.',
        tools: factory.map((t) => t.name),
      },
    ],
    external_mcp: [],
    tools: [...factory.map((t) => ({ ...t, source: 'factory' as const, ...used(t.name) })), ...builtIn],
    skills: [...(await skillsIn(deps.factorySkills ?? FACTORY_SKILLS, 'factory')), ...repoSkills.flat()],
  };
}
