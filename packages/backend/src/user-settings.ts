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
  UserSettings,
  type ProviderEnvironment,
} from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { run, type ProcessResult } from '@factory/adapters-process';

/** Runs a command on this machine; injected so tests do not need the real CLIs. */
export type Exec = (command: string, args: readonly string[]) => Promise<ProcessResult>;
const exec: Exec = (command, args) => run(command, args, { timeoutMs: 20_000 });

const out = (r: ProcessResult) => (r.code === 0 ? r.stdout.trim() : undefined);
const fail = (r: ProcessResult) => (r.stderr || r.stdout).trim().split('\n').at(-1)?.slice(0, 300);

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
  private readonly readCodexConfig: () => Promise<string | undefined>;
  constructor(
    root: string,
    storage: DataStorage,
    options: { exec?: Exec; readCodexConfig?: () => Promise<string | undefined> } = {},
  ) {
    this.path = join(root, 'user-settings.json');
    this.storage = storage;
    this.exec = options.exec ?? exec;
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

  /** Reads git identity, the GitHub login and each provider CLI, all at once. */
  async environment(): Promise<UserEnvironment> {
    const x = (command: string, ...args: string[]) => this.exec(command, args);
    const [name, email, gh, claude, codex, pi, piModels, codexConfig] = await Promise.all([
      x('git', 'config', '--global', 'user.name'),
      x('git', 'config', '--global', 'user.email'),
      x('gh', 'api', 'user', '--jq', '.login'),
      x('claude', '--version'),
      x('codex', '--version'),
      x('pi', '--version'),
      x('pi', '--list-models'),
      this.readCodexConfig(),
    ]);
    const version = (r: ProcessResult) => {
      const text = out(r);
      return text ? (parseVersion(text) ?? text.split('\n')[0]) : undefined;
    };
    const installed = (r: ProcessResult) => r.code !== 127;
    const configured = codexConfig ? codexConfiguredModel(codexConfig) : undefined;
    const ghLogin = out(gh);
    return UserEnvironment.parse({
      git: { name: out(name), email: out(email) },
      github: ghLogin ? { login: ghLogin } : { error: installed(gh) ? fail(gh) : 'gh is not installed' },
      providers: {
        claude: {
          installed: installed(claude),
          version: version(claude),
          models: CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name })),
        },
        codex: {
          installed: installed(codex),
          version: version(codex),
          models: configured ? [{ id: configured, name: `${configured} (configured)` }] : [],
        },
        pi: {
          installed: installed(pi),
          version: version(pi),
          models: out(piModels) ? parsePiModels(out(piModels)!) : [],
          ...(installed(pi) && !out(piModels) ? { error: fail(piModels) } : {}),
        },
      },
    });
  }
}
