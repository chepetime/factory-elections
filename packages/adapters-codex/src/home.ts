import { mkdirSync, symlinkSync, writeFileSync, lstatSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** The config the factory's Codex runs with: nothing of the user's (MCP servers, profiles, instructions). */
const FACTORY_CONFIG = '# Factory-owned Codex home: the user config.toml is not loaded.\n';

/**
 * A `CODEX_HOME` that holds only the factory's config. Codex reads `config.toml`, profiles and
 * instructions from `$CODEX_HOME`, so pointing it here keeps the user's `~/.codex` out of a run.
 * Only the login (`auth.json`) is linked from the user's own home so the run stays signed in.
 * An explicit `FACTORY_CODEX_HOME` overrides the location.
 */
export function isolatedCodexHome(source: NodeJS.ProcessEnv = process.env): string {
  const dir = source.FACTORY_CODEX_HOME ?? join(tmpdir(), 'factory-codex-home');
  const userHome = source.CODEX_HOME ?? join(homedir(), '.codex');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'config.toml'), FACTORY_CONFIG, { mode: 0o600 });
  if (userHome !== dir) {
    const link = join(dir, 'auth.json');
    try {
      lstatSync(link);
      rmSync(link, { force: true });
    } catch {
      // no earlier link
    }
    try {
      symlinkSync(join(userHome, 'auth.json'), link);
    } catch {
      // login stays unlinked; an API key in the environment still works
    }
  }
  return dir;
}
