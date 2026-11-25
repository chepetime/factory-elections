// The person who runs this factory: who they are, which agent providers and models the factory may
// use, and rules every agent follows in every project. One document per machine.
import { z } from 'zod';
import { parseModelRef } from './agents.ts';

/** The agent CLIs a person can turn on. Pi is a setting only until it has an execution adapter. */
export const USER_PROVIDERS = ['claude', 'codex', 'pi'] as const;
export const UserProvider = z.enum(USER_PROVIDERS);
export type UserProvider = z.infer<typeof UserProvider>;

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
    .object({
      name: z.string().max(200).optional(),
      email: z.string().max(320).optional(),
      github_username: z
        .string()
        .regex(/^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/, 'use a GitHub username, without @')
        .optional(),
    })
    .default({}),
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
  git: z.object({ name: z.string().optional(), email: z.string().optional() }),
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

/** The system prompt with the user's global rules after it, when there are any. */
export function withUserRules(systemPrompt: string, settings: UserSettings): string {
  const rules = settings.rules.trim();
  if (!rules) return systemPrompt;
  return `${systemPrompt}\n\n## Rules from the person who runs this factory\n\n${rules}`;
}

export const PROVIDER_NAMES: Record<UserProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
};
