// Shared composition for the CLI and persistent backend. No transport policy lives here.
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelRunner } from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import { storageFor } from '@factory/adapters-data';
import * as git from '@factory/adapters-git';
import * as github from '@factory/adapters-github';
import { runShell } from '@factory/adapters-process';
import { Driver, type DriverDeps, type StepPaths } from '@factory/driver';
const DEFINITIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'definitions');
const step = (name: string): StepPaths => ({
  step: join(DEFINITIONS, 'steps', `${name}.yaml`),
  ladder: join(DEFINITIONS, 'ladders', `${name}.yaml`),
});

export function composeDriver(
  root: string,
  log: (line: string) => void = () => {},
  runner?: ModelRunner,
  signal?: AbortSignal,
): Driver {
  const tasks = storageFor(root).tasks;
  const deps: DriverDeps = {
    tasks,
    readProfile: (project) => fsAdapter.readProfile(root, project),
    git,
    shell: { runShell: (command, options) => runShell(command, options) },
    github,
    runner: runner ?? {
      async run(request) {
        const { ClaudeAgentRunner } = await import('@factory/adapters-claude');
        return new ClaudeAgentRunner({ onProgress: log }).run(request);
      },
    },
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
  };
  return new Driver(deps);
}
