// A task's session log: every agent message, tool call and tool result of its runs, in order, so a
// person can follow the whole session. Live in memory while a run works; saved with the task.
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeMessageEvents } from '@factory/adapters-claude';
import type { AgentEvent } from '@factory/core';

export type SessionEntry =
  | { at: string; kind: 'run'; text: string }
  | { at: string; kind: 'text'; text: string; step?: string; sub?: boolean }
  | { at: string; kind: 'tool'; tool: string; input: string; call?: string; step?: string; sub?: boolean }
  | { at: string; kind: 'result'; ok: boolean; text: string; call?: string; sub?: boolean };

/** Kept per tool result, so a long build log cannot grow the log without bound. */
export const RESULT_LIMIT = 4000;
/** Kept per task: the oldest entries go first. */
export const ENTRY_LIMIT = 3000;

/** The one-line form of a tool call's input: the command, the path or the pattern. */
export function toolInput(name: string, input: Record<string, unknown>): string {
  const pick = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined);
  const text =
    pick('command') ??
    pick('file_path') ??
    pick('pattern') ??
    pick('url') ??
    pick('description') ??
    pick('task');
  if (text) return text.slice(0, 1000);
  const json = JSON.stringify(input);
  return json === '{}' ? '' : json.slice(0, 1000);
}

function clip(text: string): string {
  return text.length > RESULT_LIMIT
    ? `${text.slice(0, RESULT_LIMIT)}\n… ${text.length - RESULT_LIMIT} more characters`
    : text;
}

export class SessionLog {
  readonly entries: SessionEntry[];
  private readonly now: () => string;
  constructor(entries: SessionEntry[] = [], now: () => string = () => new Date().toISOString()) {
    this.entries = entries;
    this.now = now;
  }
  private push(entry: SessionEntry): void {
    this.entries.push(entry);
    if (this.entries.length > ENTRY_LIMIT) this.entries.splice(0, this.entries.length - ENTRY_LIMIT);
  }
  /** Marks where a run starts: the first run, or your reply that resumed it. */
  run(text: string, at = this.now()): void {
    this.push({ at, kind: 'run', text });
  }
  event(event: AgentEvent, step?: string, at = this.now()): void {
    const sub = 'sub' in event && event.sub ? { sub: true } : {};
    const call = 'callId' in event && event.callId ? { call: event.callId } : {};
    const where = step ? { step } : {};
    if (event.type === 'text' && event.text.trim())
      this.push({ at, kind: 'text', text: event.text, ...where, ...sub });
    if (event.type === 'tool')
      this.push({
        at,
        kind: 'tool',
        tool: event.name,
        input: toolInput(event.name, event.input),
        ...call,
        ...where,
        ...sub,
      });
    if (event.type === 'tool-result')
      this.push({ at, kind: 'result', ok: event.ok, text: clip(event.text), ...call, ...sub });
  }
}

/** Where Claude Code keeps the transcripts of sessions that ran in `cwd`. */
export function transcriptDir(cwd: string, home = homedir()): string {
  return join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
}

/**
 * A session log rebuilt from Claude's own transcripts of the sessions that ran in `cwd`, oldest
 * first: for runs from before Factory kept session logs. Unreadable lines are skipped.
 */
export async function transcriptEntries(cwd: string, home = homedir()): Promise<SessionEntry[]> {
  const dir = transcriptDir(cwd, home);
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
  const sessions = await Promise.all(
    files.map(async (file) => {
      const lines = (await readFile(join(dir, file), 'utf8').catch(() => '')).split('\n').filter(Boolean);
      const parsed = lines.flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
      const first = parsed.find((l) => typeof l.timestamp === 'string')?.timestamp as string | undefined;
      return { file, parsed, first: first ?? '' };
    }),
  );
  const log = new SessionLog();
  for (const { file, parsed, first } of sessions.sort((a, b) => a.first.localeCompare(b.first))) {
    if (!first) continue;
    log.run(`Session ${file.replace(/\.jsonl$/, '').slice(0, 8)}, from Claude's transcript`, first);
    for (const line of parsed) {
      const at = typeof line.timestamp === 'string' ? line.timestamp : first;
      for (const event of claudeMessageEvents(line)) log.event(event, 'agent', at);
    }
  }
  return log.entries;
}
