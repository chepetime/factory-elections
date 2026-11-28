// Tickets from the project's own tracker (the "list tickets" command), read from its JSON output so
// the Remote Tickets page can show cards. The command is the person's: any CLI, any shape. This reads
// the shapes the common CLIs print (GitHub `gh --json`, Jira `{ key, fields }`, Linear
// `{ identifier, state }`) and leaves anything else to the raw text view.
import { z } from 'zod';

export const RemoteTicket = z.object({
  /** `#219`, `PROJ-12` or `ENG-4`: what people call it. */
  key: z.string(),
  title: z.string(),
  state: z.string().optional(),
  /** A label's color is a hex `rrggbb` when the tracker has one. */
  labels: z.array(z.object({ name: z.string(), color: z.string().optional() })),
  assignees: z.array(z.string()),
  author: z.string().optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
  updated_at: z.string().optional(),
  comments: z.number().optional(),
});
export type RemoteTicket = z.infer<typeof RemoteTicket>;

type Json = Record<string, unknown>;
const object = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;
/** The first candidate that `read` turns into a value. */
const first = <T>(read: (v: unknown) => T | undefined, ...candidates: unknown[]): T | undefined => {
  for (const c of candidates) {
    const v = read(c);
    if (v !== undefined) return v;
  }
  return undefined;
};
/** A name from a string or from a record's usual name fields. */
const named = (v: unknown): string | undefined => {
  const o = object(v);
  return o ? first(text, o.displayName, o.display_name, o.name, o.login, o.title, o.value, o.key) : text(v);
};
/** A list from an array, a GraphQL `{ nodes }` connection, or one item. */
const many = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  const nodes = object(v)?.nodes;
  if (Array.isArray(nodes)) return nodes;
  return v ? [v] : [];
};
const hex = (v: unknown): string | undefined => {
  const c = text(v)?.replace(/^#/, '');
  return c && /^[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined;
};
const label = (l: unknown): RemoteTicket['labels'] => {
  const name = named(l);
  if (!name) return [];
  const color = hex(object(l)?.color);
  return [color ? { name, color } : { name }];
};
/** A comment count from an array, a number, or a `{ totalCount }` connection. */
const count = (v: unknown): number | undefined => {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'number') return v;
  const total = object(v)?.totalCount;
  return typeof total === 'number' ? total : undefined;
};
const numbered = (v: unknown): string | undefined => (typeof v === 'number' ? `#${v}` : undefined);

/** The fields a card can show without them: read from the record or its Jira-style `fields`. */
function details(r: Json, f: Json) {
  const all = {
    state: first(named, r.state, r.status, f.status),
    author: first(named, r.author, r.creator, f.reporter, f.creator),
    priority: first(named, r.priority, f.priority),
    type: first(named, r.issueType, r.type, f.issuetype),
    url: first(text, r.url, r.html_url, r.webUrl),
    updated_at: first(text, r.updatedAt, r.updated_at, r.updated, f.updated),
    comments: count(r.comments),
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
}

/** One record as a ticket, or undefined when it has neither a key nor a title. */
function ticket(raw: unknown): RemoteTicket | undefined {
  const r = object(raw);
  if (!r) return undefined;
  const f = object(r.fields) ?? {};
  const key = first(text, r.identifier, r.key) ?? numbered(r.number) ?? text(r.id);
  const title = first(text, r.title, r.summary, f.summary, r.name);
  if (!key || !title) return undefined;
  return {
    key,
    title,
    labels: many(r.labels ?? f.labels).flatMap(label),
    assignees: many(r.assignees ?? r.assignee ?? f.assignee).flatMap((a) => named(a) ?? []),
    ...details(r, f),
  };
}

/** The ticket list inside a wrapper object: `issues`, `items`, `workItems`, `nodes` or `data.issues`. */
function holder(o: Json): unknown[] | undefined {
  const candidates = [
    o.issues,
    o.items,
    o.workItems,
    o.nodes,
    object(o.data)?.issues,
    object(o.issues)?.nodes,
  ];
  return candidates.find(Array.isArray) as unknown[] | undefined;
}

/**
 * The tickets in a listing command's output, or undefined when it is not JSON tickets (then the
 * page shows the text as it is). Accepts an array, or an object holding one (`issues`, `nodes`…).
 */
export function parseTickets(output: string): RemoteTicket[] | undefined {
  const trimmed = output.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const o = object(data) ?? {};
  const list = (Array.isArray(data) ? data : undefined) ?? holder(o);
  if (!list) return undefined;
  const tickets = list.map(ticket);
  // Every record must read as a ticket; a partial read would hide some of them.
  return tickets.every((t): t is RemoteTicket => t !== undefined) ? tickets : undefined;
}
