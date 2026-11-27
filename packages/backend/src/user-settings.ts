// User settings: the person who runs this factory, the agent providers and models it may use, and
// their global rules. One document in the data root, beside the projects.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CLAUDE_MODELS,
  parseVersion,
  UserEnvironment,
  UserProvider,
  UserSettings,
  type ProviderCheck,
  type ProviderEnvironment,
} from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { run, type ProcessResult } from '@factory/adapters-process';

/** Runs a command on this machine; injected so tests do not need the real CLIs. */
export type Exec = (
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number },
) => Promise<ProcessResult>;
const exec: Exec = (command, args, options) =>
  run(command, args, { timeoutMs: options?.timeoutMs ?? 20_000 });

/** The one-word prompt of the "responds" test. */
export const TEST_PROMPT = 'Reply with one word: ok';
const TEST_TIMEOUT_MS = 60_000;
const TEST_COST_NOTE = 'Sends one one-word prompt to the cheapest model: costs a fraction of a cent.';

const INSTALL_FIX: Record<UserProvider, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
  pi: 'npm i -g @earendil-works/pi-coding-agent',
};
const LOGIN_FIX: Record<UserProvider, string> = {
  claude: 'claude auth login',
  codex: 'codex login',
  pi: 'Run pi and use /login, or set a provider API key such as ANTHROPIC_API_KEY.',
};

const out = (r: ProcessResult) => (r.code === 0 ? r.stdout.trim() : undefined);
const fail = (r: ProcessResult) => (r.stderr || r.stdout).trim().split('\n').at(-1)?.slice(0, 300);
/** The CLI's own words, whole, so a person sees exactly what it said. */
const errorText = (r: ProcessResult): string =>
  (r.stderr.trim() || r.stdout.trim() || `exited with code ${r.code}`).slice(0, 2000);

/** `pi --list-models` prints a table: provider, model, context, … with one header row. */
export function parsePiModels(table: string): ProviderEnvironment['models'] {
  return table
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[0] && cols[1])
    .map(([group, model]) => ({ id: `${group}/${model}`, name: model!, group: group! }));
}

/** The `model = "…"` line of a Codex config.toml, when there is one at the top level. */
export function codexConfiguredModel(toml: string): string | undefined {
  for (const line of toml.split('\n')) {
    if (line.trim().startsWith('[')) return undefined;
    const match = /^\s*model\s*=\s*"([^"]+)"/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export class UserSettingsService {
  private readonly path: string;
  private readonly storage: DataStorage;
  private readonly exec: Exec;
  private readonly env: NodeJS.ProcessEnv;
  private readonly projects: () => Promise<readonly { name: string; repo: string }[]>;
  private readonly readCodexConfig: () => Promise<string | undefined>;
  constructor(
    root: string,
    storage: DataStorage,
    options: {
      exec?: Exec;
      readCodexConfig?: () => Promise<string | undefined>;
      /** Environment variables, to see an API key; defaults to this process's. */
      env?: NodeJS.ProcessEnv;
      /** Registered projects, to read the email each repository sets for itself. */
      projects?: () => Promise<readonly { name: string; repo: string }[]>;
    } = {},
  ) {
    this.path = join(root, 'user-settings.json');
    this.storage = storage;
    this.exec = options.exec ?? exec;
    this.env = options.env ?? process.env;
    this.projects = options.projects ?? (async () => []);
    this.readCodexConfig =
      options.readCodexConfig ??
      (() =>
        readFile(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'), 'utf8').catch(
          () => undefined,
        ));
  }

  async get(): Promise<UserSettings> {
    try {
      return UserSettings.parse(await this.storage.readDocument(this.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return UserSettings.parse({});
      throw error;
    }
  }

  async save(raw: unknown): Promise<UserSettings> {
    const { json } = z.object({ json: z.string().max(200_000) }).parse(raw);
    // Empty strings mean "not set": drop them before checking, so a cleared field is valid.
    const input = JSON.parse(json, (_k, v: unknown) => (v === '' ? undefined : v)) as object;
    const settings = UserSettings.parse({ ...input, updated_at: new Date().toISOString() });
    await this.storage.writeDocument(this.path, settings);
    return settings;
  }

  /**
   * Reads git identity, the GitHub login and each provider CLI, all at once. Nothing here calls a
   * model: the signed-in checks only read each CLI's local login state.
   */
  async environment(): Promise<UserEnvironment> {
    const x = (command: string, ...args: string[]) => this.exec(command, args);
    const hasAnthropicKey = Boolean(this.env.ANTHROPIC_API_KEY);
    const [name, email, gh, claude, codex, pi, piModels, codexConfig, projectEmails, claudeAuth, codexAuth] =
      await Promise.all([
        x('git', 'config', '--global', 'user.name'),
        x('git', 'config', '--global', 'user.email'),
        x('gh', 'api', 'user', '--jq', '.login'),
        x('claude', '--version'),
        x('codex', '--version'),
        x('pi', '--version'),
        x('pi', '--list-models'),
        this.readCodexConfig(),
        this.projectEmails(),
        hasAnthropicKey ? Promise.resolve(undefined) : x('claude', 'auth', 'status'),
        x('codex', 'login', 'status'),
      ]);
    const version = (r: ProcessResult) => {
      const text = out(r);
      return text ? (parseVersion(text) ?? text.split('\n')[0]) : undefined;
    };
    const installed = (r: ProcessResult) => r.code !== 127;
    const configured = codexConfig ? codexConfiguredModel(codexConfig) : undefined;
    const ghLogin = out(gh);
    const piList = out(piModels) ? parsePiModels(out(piModels)!) : [];

    const installedCheck = (provider: UserProvider, r: ProcessResult): ProviderCheck => {
      const ok = installed(r);
      return {
        name: 'installed',
        ok,
        checked_at: new Date().toISOString(),
        ...(ok
          ? { detail: version(r) ? `Version ${version(r)}` : 'Found' }
          : { error: errorText(r), fix: INSTALL_FIX[provider] }),
      };
    };
    const signedIn = (
      provider: UserProvider,
      isInstalled: boolean,
      result: { ok: boolean; detail?: string; error?: string },
    ): ProviderCheck => ({
      name: 'signed_in',
      ok: isInstalled && result.ok,
      checked_at: new Date().toISOString(),
      ...(isInstalled && result.ok
        ? { detail: result.detail }
        : isInstalled
          ? { error: result.error, fix: LOGIN_FIX[provider] }
          : { error: 'Not installed, so it cannot be signed in.', fix: INSTALL_FIX[provider] }),
    });
    const fromAuth = (r: ProcessResult, ok: string) =>
      r.code === 0
        ? { ok: true, detail: (r.stdout.trim() || r.stderr.trim()).split('\n')[0] || ok }
        : { ok: false, error: errorText(r) };

    return UserEnvironment.parse({
      git: { name: out(name), email: out(email), project_emails: projectEmails },
      github: ghLogin ? { login: ghLogin } : { error: installed(gh) ? fail(gh) : 'gh is not installed' },
      providers: {
        claude: {
          installed: installed(claude),
          version: version(claude),
          models: CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name })),
          checks: [
            installedCheck('claude', claude),
            signedIn(
              'claude',
              installed(claude),
              claudeAuth
                ? fromAuth(claudeAuth, 'Signed in')
                : { ok: true, detail: 'ANTHROPIC_API_KEY is set' },
            ),
          ],
        },
        codex: {
          installed: installed(codex),
          version: version(codex),
          models: configured ? [{ id: configured, name: `${configured} (configured)` }] : [],
          checks: [
            installedCheck('codex', codex),
            signedIn('codex', installed(codex), fromAuth(codexAuth!, 'Signed in')),
          ],
        },
        pi: {
          installed: installed(pi),
          version: version(pi),
          models: piList,
          ...(installed(pi) && !out(piModels) ? { error: fail(piModels) } : {}),
          checks: [
            installedCheck('pi', pi),
            // Pi lists only the models it has a login or API key for.
            signedIn(
              'pi',
              installed(pi),
              piList.length > 0
                ? { ok: true, detail: `${piList.length} models available` }
                : {
                    ok: false,
                    error: out(piModels) ? 'pi --list-models listed no models.' : errorText(piModels),
                  },
            ),
          ],
        },
      },
    });
  }

  /**
   * The "responds" check: one one-word prompt to the cheapest model of a provider. This is a real model
   * call, so it runs only when the person asks for it.
   */
  async testProvider(raw: string): Promise<ProviderCheck> {
    const provider = UserProvider.parse(raw);
    const model = await this.cheapestModel(provider);
    const [command, args] = ((): [string, string[]] => {
      switch (provider) {
        case 'claude':
          return ['claude', ['-p', TEST_PROMPT, '--model', model!]];
        case 'codex':
          return ['codex', ['exec', '--skip-git-repo-check', ...(model ? ['-m', model] : []), TEST_PROMPT]];
        case 'pi':
          return ['pi', ['-p', TEST_PROMPT, ...(model ? ['--model', model] : [])]];
      }
    })();
    const started = Date.now();
    const r = await this.exec(command, args, { timeoutMs: TEST_TIMEOUT_MS });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const base = {
      name: 'responds' as const,
      checked_at: new Date().toISOString(),
      cost_note: TEST_COST_NOTE,
    };
    if (r.code === 127) return { ...base, ok: false, error: errorText(r), fix: INSTALL_FIX[provider] };
    if (r.stopped === 'timeout')
      return {
        ...base,
        ok: false,
        error: `No answer within ${TEST_TIMEOUT_MS / 1000} seconds.`,
        fix: LOGIN_FIX[provider],
      };
    if (r.code !== 0 || !r.stdout.trim())
      return { ...base, ok: false, error: errorText(r), fix: LOGIN_FIX[provider] };
    return {
      ...base,
      ok: true,
      detail: `${model ?? 'default model'} answered "${r.stdout.trim().slice(0, 80)}" in ${seconds}s`,
    };
  }

  /** The cheapest model per provider: Haiku for Claude, the configured one for Codex, the first Pi lists. */
  private async cheapestModel(provider: UserProvider): Promise<string | undefined> {
    if (provider === 'claude') return (CLAUDE_MODELS.find((m) => /haiku/i.test(m.id)) ?? CLAUDE_MODELS[0]).id;
    if (provider === 'codex') {
      const config = await this.readCodexConfig();
      return config ? codexConfiguredModel(config) : undefined;
    }
    const list = await this.exec('pi', ['--list-models']);
    return out(list) ? parsePiModels(out(list)!)[0]?.id : undefined;
  }

  /** The `user.email` each project repository sets in its own git config, when it sets one. */
  private async projectEmails(): Promise<{ project: string; email: string }[]> {
    const projects = await this.projects().catch(() => []);
    const found = await Promise.all(
      projects.map(async (p) => ({
        project: p.name,
        email: out(await this.exec('git', ['-C', p.repo, 'config', '--local', 'user.email'])),
      })),
    );
    return found.filter((f): f is { project: string; email: string } => Boolean(f.email));
  }
}
