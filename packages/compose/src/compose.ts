// Shared composition for the CLI and persistent backend. No transport policy lives here.
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_CAPABILITIES, ProviderRouter, type ModelRunner } from '@factory/core';
// A constant only: the Codex adapter has no SDK, so this import stays cheap.
import { CODEX_APP_SERVER_CAPABILITIES } from '@factory/adapters-codex';
import * as fsAdapter from '@factory/adapters-fs';
import { storageFor } from '@factory/adapters-data';
import * as git from '@factory/adapters-git';
import * as github from '@factory/adapters-github';
import { runShell } from '@factory/adapters-process';
import { Driver, type DelegationPort, type DriverDeps, type StepPaths } from '@factory/driver';
const DEFINITIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'definitions');
const step = (name: string): StepPaths => ({
  step: join(DEFINITIONS, 'steps', `${name}.yaml`),
  ladder: join(DEFINITIONS, 'ladders', `${name}.yaml`),
});

/** Every provider behind one ModelRunner; the model reference picks the provider. */
export function providerRunner(log: (line: string) => void = () => {}): ModelRunner {
  return new ProviderRouter({
    // Lazy imports keep the SDK out of CLI startup; the capabilities match each adapter's own.
    claude: {
      capabilities: PROVIDER_CAPABILITIES.claude,
      async run(request) {
        const { ClaudeAgentRunner } = await import('@factory/adapters-claude');
        return new ClaudeAgentRunner({ onProgress: log }).run(request);
      },
    },
    pi: {
      capabilities: PROVIDER_CAPABILITIES.pi,
      async run(request) {
        const { runPi } = await import('./pi.ts');
        return runPi(request);
      },
    },
    // FACTORY_CODEX_TRANSPORT=app-server selects the phase 2 app-server runner; the default stays
    // `codex exec`.
    codex:
      process.env.FACTORY_CODEX_TRANSPORT === 'app-server'
        ? {
            capabilities: CODEX_APP_SERVER_CAPABILITIES,
            async run(request) {
              const { CodexAppServerRunner } = await import('@factory/adapters-codex');
              return new CodexAppServerRunner({ onProgress: log }).run(request);
            },
          }
        : {
            capabilities: PROVIDER_CAPABILITIES.codex,
            async run(request) {
              const { CodexRunner } = await import('@factory/adapters-codex');
              return new CodexRunner({ onProgress: log }).run(request);
            },
          },
  });
}

export function composeDriver(
  root: string,
  log: (line: string) => void = () => {},
  runner?: ModelRunner,
  signal?: AbortSignal,
  delegation?: DelegationPort,
  extras: Pick<DriverDeps, 'repositoryFacts' | 'contextLimits' | 'agentSession'> = {},
): Driver {
  const tasks = storageFor(root).tasks;
  const deps: DriverDeps = {
    tasks,
    readProfile: (project) => fsAdapter.readProfile(root, project),
    git,
    shell: { runShell: (command, options) => runShell(command, options) },
    github,
    runner: runner ?? providerRunner(log),
    definitions: {
      readStep: fsAdapter.readStepDefinition,
      readLadder: fsAdapter.readLadder,
      exists: (path) =>
        access(path).then(
          () => true,
          () => false,
        ),
    },
    steps: {
      classifier: step('classifier'),
      coder: step('coder'),
      reviewer: step('reviewer'),
      prWriter: step('pr-writer'),
    },
    now: () => new Date().toISOString(),
    log,
    ...(signal ? { signal } : {}),
    ...(delegation ? { delegation } : {}),
    ...extras,
  };
  return new Driver(deps);
}
