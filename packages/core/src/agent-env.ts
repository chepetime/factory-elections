// The environment an agent process gets: an allowlist, not the backend's own environment. The
// backend's environment holds secrets an agent must not read (storage credentials from .env,
// cloud keys and tokens from the user's shell), and anything it reads it can print or send.
// An agent gets what its tools need to run, plus its own provider's credential only.
import type { ProviderId } from './agents.ts';

/** Names every agent gets when the host has them: tool lookup, locale, temp files, proxies. */
const NAMES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TERM',
  'COLORTERM',
  'LANG',
  'TZ',
  'EDITOR',
  'VISUAL',
  '__CF_USER_TEXT_ENCODING',
  'PNPM_HOME',
  'COREPACK_HOME',
  'COREPACK_ENABLE_AUTO_PIN',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',
  'JAVA_HOME',
  'GOPATH',
  'GOROOT',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'VIRTUAL_ENV',
] as const;

/** Prefixes of version managers and locale settings, which locate tools and set no secrets. */
const PREFIXES = ['LC_', 'XDG_', 'MISE_', '__MISE_', 'ASDF_', 'NVM_', 'FNM_'] as const;

/** Each provider's own credential and configuration; the other provider's never pass. */
export const PROVIDER_ENV: Record<ProviderId, readonly string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR'],
  codex: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CODEX_HOME'],
};

/** A variable name: what `sandbox.pass_env` and FACTORY_AGENT_ENV_ALLOW may list. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names from a comma-separated list such as FACTORY_AGENT_ENV_ALLOW; invalid names are ignored. */
export function envNames(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => ENV_NAME.test(n));
}

/**
 * The environment for one agent process of `provider`, from the host's `source`. `extra` names
 * more variables to pass (a profile's `sandbox.pass_env`, FACTORY_AGENT_ENV_ALLOW). Explicit
 * values the caller chose (a profile's `sandbox.env`) are added after this, not here.
 */
export function agentEnvironment(
  provider: ProviderId,
  source: NodeJS.ProcessEnv,
  extra: readonly string[] = [],
): Record<string, string> {
  const allowed = new Set<string>([...NAMES, ...PROVIDER_ENV[provider], ...extra]);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowed.has(name) || PREFIXES.some((p) => name.startsWith(p))) env[name] = value;
  }
  return env;
}

/**
 * The agent session that started this process, when one did: the factory runs inside it, and its
 * agents' permissions may be capped by it. Agent turns never get its variables (see above).
 */
export function hostAgentSession(source: NodeJS.ProcessEnv): 'claude-code' | undefined {
  return source.CLAUDECODE === '1' || source.CLAUDE_CODE_SESSION_ID ? 'claude-code' : undefined;
}
