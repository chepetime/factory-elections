// Read-only commands that show the factory's state, for a person or an agent that debugs it:
// a ticket with its events, a PR review with what its turns did, the newest spans, and where the
// data lives. Tickets and spans come from the running backend; review files are read from disk,
// so `review diagnose` works while the backend is down.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Call = (method: string, request: object) => Promise<{ json: string }>;

async function withBackend<T>(run: (call: Call) => Promise<T>): Promise<T> {
  const { backendCall, closeBackendClient } = await import('@factory/backend-client');
  try {
    return await run((method, request) =>
      (backendCall as unknown as (m: string, r: object, t?: number) => Promise<{ json: string }>)(
        method,
        request,
        30_000,
      ),
    );
  } finally {
    closeBackendClient();
  }
}

export function issueShow(project: string, key: string) {
  return withBackend(async (call) =>
    JSON.parse((await call('GetIssue', { project, json: JSON.stringify({ key }) })).json),
  );
}

export function issueList(project: string) {
  return withBackend(async (call) => JSON.parse((await call('ListIssues', { project, id: '' })).json));
}

export function spans(project: string, type: string, limit: number) {
  return withBackend(async (call) =>
    JSON.parse((await call('ListSpans', { project, json: JSON.stringify({ type, limit }) })).json),
  );
}

/** Where the factory keeps its data and logs, and whether a backend holds the lock. */
export function paths(root: string) {
  const lock = join(root, 'backend.lock');
  return {
    data_root: root,
    backend_lock: existsSync(lock) ? lock : null,
    logs: join(root, 'logs'),
    project_dir: join(root, '<project>'),
    // With storage.json, tickets and runs live in Postgres (read them with `issue show`, `task show`).
    storage: existsSync(join(root, 'storage.json')) ? 'postgres' : 'files',
    tasks: existsSync(join(root, 'storage.json')) ? null : join(root, '<project>', 'tasks', '<run-id>'),
    reviews: join(root, '<project>', 'reviews', '<pr-number>'),
    health: `http://127.0.0.1:${process.env.FACTORY_HEALTH_PORT ?? 4318}/health`,
    backend: process.env.FACTORY_BACKEND_ADDRESS ?? `127.0.0.1:${process.env.FACTORY_BACKEND_PORT ?? 4319}`,
  };
}

const REFUSAL = /requested permissions|haven't granted|requires approval|permission (?:was )?denied/i;

interface TurnFacts {
  turn: number;
  at?: string;
  label?: string;
  exit: string | null;
  permission_mode?: string;
  cli_version?: string;
  model?: string;
  tool_calls: number;
  failed_tool_calls: number;
  refused: string[];
  result?: string;
  cost_usd?: number;
}

/**
 * What each turn of a PR review did, from its files: exit code, permission mode, tool calls, the
 * calls a permission check refused, and the result. The same facts a person reads from the logs.
 */
export async function reviewDiagnose(root: string, project: string, number: number) {
  const dir = join(root, project, 'reviews', String(number));
  if (!existsSync(dir)) throw new Error(`No review files in ${dir}.`);
  const run = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as {
    url?: string;
    branch?: string;
    worktree?: string;
    started_at?: string;
    turns?: { at: string; label?: string; stopped?: boolean }[];
  };
  const files = await readdir(dir);
  const turns: TurnFacts[] = [];
  for (const [k, t] of (run.turns ?? []).entries()) {
    const facts: TurnFacts = {
      turn: k,
      at: t.at,
      ...(t.label ? { label: t.label } : {}),
      exit: files.includes(`turn-${k}.exit`)
        ? (await readFile(join(dir, `turn-${k}.exit`), 'utf8')).trim()
        : t.stopped
          ? 'stopped'
          : null,
      tool_calls: 0,
      failed_tool_calls: 0,
      refused: [],
    };
    const log = files.includes(`turn-${k}.jsonl`) ? await readFile(join(dir, `turn-${k}.jsonl`), 'utf8') : '';
    for (const line of log.split('\n')) {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (e.type === 'system' && e.subtype === 'init') {
        if (typeof e.permissionMode === 'string') facts.permission_mode = e.permissionMode;
        if (typeof e.claude_code_version === 'string') facts.cli_version = e.claude_code_version;
        if (typeof e.model === 'string') facts.model = e.model;
      }
      const content = (e.message as { content?: unknown } | undefined)?.content;
      if (e.type === 'assistant' && Array.isArray(content))
        facts.tool_calls += content.filter((c) => (c as { type?: string }).type === 'tool_use').length;
      if (e.type === 'user' && Array.isArray(content))
        for (const c of content as { type?: string; is_error?: boolean; content?: unknown }[]) {
          if (c.type !== 'tool_result' || !c.is_error) continue;
          facts.failed_tool_calls++;
          const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
          if (REFUSAL.test(text)) facts.refused.push(text.slice(0, 200));
        }
      if (e.type === 'result') {
        if (typeof e.subtype === 'string') facts.result = e.subtype;
        if (typeof e.total_cost_usd === 'number') facts.cost_usd = e.total_cost_usd;
      }
    }
    turns.push(facts);
  }
  return {
    dir,
    url: run.url,
    branch: run.branch,
    worktree: run.worktree,
    payload: files.includes('payload.json') ? join(dir, 'payload.json') : null,
    turns,
  };
}
