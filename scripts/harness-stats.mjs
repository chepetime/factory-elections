#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'AGENTS.md',
  'apps/web/AGENTS.md',
  'docs/harnes/RUNNING.md',
  'docs/harnes/BROWSER.md',
  'docs/harnes/TERMINAL.md',
  'docs/harnes/CODE_MAP.md',
];
let broken = false;
for (const file of files) {
  const content = readFileSync(resolve(root, file), 'utf8');
  console.log(
    `${file}: ${Buffer.byteLength(content)} bytes; ~${Math.ceil(content.length / 4)} tokens (characters/4 estimate)`,
  );
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!existsSync(resolve(root, dirname(file), target))) {
      console.error(`Missing pointer: ${file} -> ${target}`);
      broken = true;
    }
  }
}
console.log('Estimates are documentation size proxies, not tokenizer counts or billed session usage.');
process.exitCode = broken ? 1 : 0;
