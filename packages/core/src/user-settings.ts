// The person who runs this factory: who they are, which agent providers and models the factory may
// use, and rules every agent follows in every project. One document per machine.
import { z } from 'zod';
import { parseModelRef } from './agents.ts';

/** The agent CLIs a person can turn on. Pi is a setting only until it has an execution adapter. */
export const USER_PROVIDERS = ['claude', 'codex', 'pi'] as const;
export const UserProvider = z.enum(USER_PROVIDERS);
export type UserProvider = z.infer<typeof UserProvider>;

/** Inbox item kinds, in the order the notification settings list them. */
export const NOTIFY_KINDS = [
  'gate',
  'blocked',
  'failed',
  'question',
  'approve-spec',
  'approve-board',
  'qa',
  'merge',
  'review',
  'tending',
  'recovery',
] as const;

export const ProviderSettings = z.object({
  enabled: z.boolean().default(true),
  /** Models the factory must not use. A deny list, so a model the CLI adds later starts enabled. */
  disabled_models: z.array(z.string().min(1)).default([]),
  /** Models the person added by id, for CLIs that cannot list their models (Codex). */
  custom_models: z.array(z.string().min(1).max(200)).default([]),
  /** The model to offer first, when set. */
  default_model: z.string().min(1).optional(),
});
export type ProviderSettings = z.infer<typeof ProviderSettings>;

export const UserSettings = z.object({
  identity: z
    .preprocess(
      // Settings saved before `emails` had one `email`.
      (v) => {
        if (!v || typeof v !== 'object' || !('email' in v)) return v;
        const { email, ...rest } = v as { email?: unknown; emails?: unknown };
        return { ...rest, emails: rest.emails ?? (typeof email === 'string' && email ? [email] : []) };
      },
      z.object({
        name: z.string().max(200).optional(),
        /** Every email the person commits with, e.g. personal and work. The first is the primary one. */
        emails: z.array(z.email().max(320)).max(20).default([]),
        github_username: z
          .string()
          .regex(/^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/, 'use a GitHub username, without @')
          .optional(),
        /** Who the person is and how they like to work; agents get it with the rules. */
        about: z.string().max(2000).optional(),
      }),
    )
    .default({ emails: [] }),
  preferences: z
    .object({
      /** Light by default: the app was light-only before this setting. */
      theme: z.enum(['system', 'light', 'dark']).default('light'),
      /** An IANA zone for times in the app. Absent means the browser's own zone. */
      time_zone: z.string().max(100).optional(),
    })
    .default({ theme: 'light' }),
  /** Defaults for the new-task composer. */
  tasks: z
    .object({
      default_type: z.enum(['ticket', 'work', 'review', 'general']).default('work'),
      /** New tasks start a run at once; off adds them to the board in Todo. */
      start_runs: z.boolean().default(false),
      /** Show the optional Jira issue key field for "Work on task". */
      jira_key_field: z.boolean().default(true),
    })
    .default({ default_type: 'work', start_runs: false, jira_key_field: true }),
  chat: z
    .object({ approval_mode: z.enum(['request', 'auto', 'full']).default('request') })
    .default({ approval_mode: 'request' }),
  notifications: z
    .object({
      /** Browser banners for new inbox items while the app tab is in the background. */
      browser: z.boolean().default(false),
      /** Inbox kinds that never raise a banner. They still show in the inbox. */
      muted: z.array(z.enum(NOTIFY_KINDS)).default([]),
    })
    .default({ browser: false, muted: [] }),
  providers: z
    .object({
      claude: ProviderSettings.default(ProviderSettings.parse({})),
      codex: ProviderSettings.default(ProviderSettings.parse({})),
      pi: ProviderSettings.default(ProviderSettings.parse({})),
    })
    .default({
      claude: ProviderSettings.parse({}),
      codex: ProviderSettings.parse({}),
      pi: ProviderSettings.parse({}),
    }),
  /** Markdown every agent gets in every project, after its own instructions. */
  rules: z.string().max(20_000).default(''),
  updated_at: z.string().optional(),
});
export type UserSettings = z.infer<typeof UserSettings>;

/** Claude models the factory knows. Claude Code cannot list them, so this list is the catalog. */
export const CLAUDE_MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', hint: 'Balanced. The default.' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', hint: 'Strongest, slower and costlier.' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', hint: 'Fast and cheap, for light work.' },
  { id: 'claude-fable-5-2', name: 'Fable 5.2', hint: 'Long, careful work.' },
] as const;

/** What the machine has for one provider: the CLI, its version and the models it offers. */
export const ProviderEnvironment = z.object({
  installed: z.boolean(),
  version: z.string().optional(),
  /** `group` is Pi's upstream provider, e.g. `anthropic`. */
  models: z.array(z.object({ id: z.string(), name: z.string().optional(), group: z.string().optional() })),
  /** Why the models could not be read, when they could not. */
  error: z.string().optional(),
});
export type ProviderEnvironment = z.infer<typeof ProviderEnvironment>;

/** What the factory found on this machine, to fill in and check the user settings. */
export const UserEnvironment = z.object({
  git: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    /** Emails the project repositories set in their own git config, e.g. a work email. */
    project_emails: z.array(z.object({ project: z.string(), email: z.string() })).default([]),
  }),
  github: z.object({ login: z.string().optional(), error: z.string().optional() }),
  providers: z.object({ claude: ProviderEnvironment, codex: ProviderEnvironment, pi: ProviderEnvironment }),
});
export type UserEnvironment = z.infer<typeof UserEnvironment>;

/** Undefined when a call to this model reference may run; otherwise why the user turned it off. */
export function modelRefused(settings: UserSettings, ref: string): string | undefined {
  const { provider, model } = parseModelRef(ref);
  const p = settings.providers[provider];
  if (!p.enabled) return `${PROVIDER_NAMES[provider]} is turned off in your user settings`;
  if (model && p.disabled_models.includes(model)) return `${model} is turned off in your user settings`;
  return undefined;
}

/** The system prompt with what the person wrote about themselves and their rules, when there is any. */
export function withUserRules(systemPrompt: string, settings: UserSettings): string {
  const about = settings.identity.about?.trim();
  const rules = settings.rules.trim();
  let out = systemPrompt;
  if (about) out += `\n\n## About the person you work for\n\n${about}`;
  if (rules) out += `\n\n## Rules from the person who runs this factory\n\n${rules}`;
  return out;
}

export const PROVIDER_NAMES: Record<UserProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
};
