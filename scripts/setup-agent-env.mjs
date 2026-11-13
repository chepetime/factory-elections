#!/usr/bin/env node
// Create project-local agent settings without changing the user's shell or toolchain configuration.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 26) throw new Error(`Node.js 26 or later is required; found ${process.versions.node}`);

function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue looking on PATH.
    }
  }
  throw new Error(`${name} is required on PATH`);
}

let pnpm = executable('pnpm');
// A mise shim resolves to the mise executable. Ask mise for the selected installation,
// so agents do not invoke the shim or need access to the user's mise configuration.
if (/(?:^|\/)mise$/.test(pnpm)) {
  pnpm = realpathSync(execFileSync(pnpm, ['which', 'pnpm'], { encoding: 'utf8' }).trim());
}
const runtime = join(root, 'plain_modules', '.turri', 'cache');
const settingsDir = join(root, '.turri');
const path = [dirname(process.execPath), dirname(pnpm), process.env.PATH ?? ''].join(delimiter);
for (const value of [runtime, path]) {
  if (/[\r\n]/.test(value)) throw new Error('Tool paths must not contain newlines');
}
mkdirSync(runtime, { recursive: true });
mkdirSync(settingsDir, { recursive: true });
writeFileSync(join(settingsDir, 'agent.env'), `XDG_RUNTIME_DIR=${runtime}\nPATH=${path}\n`, { mode: 0o600 });
console.log('Created .turri/agent.env with project-local runtime settings.');
