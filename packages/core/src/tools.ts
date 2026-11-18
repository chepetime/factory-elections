import { z } from 'zod';

/** The visibility of an operation's effects, ordered from least to most visible. */
export const ToolLevel = z.enum(['read', 'draft', 'publish']);
export type ToolLevel = z.infer<typeof ToolLevel>;

export const ToolProvider = z.enum([
  'github',
  'jira',
  'confluence',
  'slack',
  'fathom',
  'figma',
  'sentry',
  'new_relic',
  'browser',
  'local_services',
]);
export type ToolProvider = z.infer<typeof ToolProvider>;

export const ToolOperation = z.object({ name: z.string().min(1), level: ToolLevel });
export type ToolOperation = z.infer<typeof ToolOperation>;
export const ToolDefinition = z.object({
  name: z.string().min(1),
  provider: ToolProvider,
  operations: z.array(ToolOperation).min(1),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;

/** Planned broker capabilities; this catalog does not grant access or implement adapters. */
export const TOOL_CATALOG: readonly ToolDefinition[] = [
  {
    name: 'github',
    provider: 'github',
    operations: [
      ...[
        'read_pr',
        'read_files',
        'read_diff',
        'read_checks',
        'read_ci_logs',
        'read_threads',
        'read_history',
      ].map((name) => ({ name, level: 'read' as const })),
      { name: 'draft_review', level: 'draft' },
      ...['submit_review', 'reply_thread', 'resolve_thread'].map((name) => ({
        name,
        level: 'publish' as const,
      })),
    ],
  },
  {
    name: 'jira',
    provider: 'jira',
    operations: [
      ...['read_issue', 'read_links', 'read_epic', 'search'].map((name) => ({
        name,
        level: 'read' as const,
      })),
      ...['create_ticket', 'comment', 'transition'].map((name) => ({ name, level: 'publish' as const })),
    ],
  },
  { name: 'confluence', provider: 'confluence', operations: [{ name: 'read_page', level: 'read' }] },
  {
    name: 'slack',
    provider: 'slack',
    operations: [
      { name: 'read_thread', level: 'read' },
      { name: 'post_message', level: 'publish' },
    ],
  },
  { name: 'fathom', provider: 'fathom', operations: [{ name: 'read_meeting', level: 'read' }] },
  { name: 'figma', provider: 'figma', operations: [{ name: 'read_frame', level: 'read' }] },
  { name: 'sentry', provider: 'sentry', operations: [{ name: 'read_incidents', level: 'read' }] },
  { name: 'new_relic', provider: 'new_relic', operations: [{ name: 'read_incidents', level: 'read' }] },
  {
    name: 'browser',
    provider: 'browser',
    operations: [
      { name: 'inspect', level: 'read' },
      { name: 'screenshot', level: 'draft' },
    ],
  },
  {
    name: 'local_services',
    provider: 'local_services',
    operations: [
      { name: 'start', level: 'draft' },
      { name: 'stop', level: 'draft' },
    ],
  },
];
