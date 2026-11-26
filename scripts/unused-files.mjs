#!/usr/bin/env node
// Finds source files that no other file imports. A file nobody imports still reads as a live code
// path, so a person or an agent can follow it to a wrong conclusion (a health panel no page showed).
// Entry points are not reported: Next.js route files, package entry files, tests, stories, scripts.
// Usage: node scripts/unused-files.mjs   (exit 1 when it finds any). Keep a file on purpose with a
// line `// unused-files: keep <reason>` in it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOTS = ['apps/web/src', 'apps/cli/src', 'apps/backend/src', 'packages'];
// `protocol`: generated provider protocol types, kept whole per CLI version.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'test',
  'e2e',
  'stories',
  'fixtures',
  'protocol',
]);
const SOURCE = /\.(ts|tsx|mjs)$/;
/** Files a framework or a package.json loads by name, not by import. */
const ENTRY = [
  /\/app\/.*\/(page|layout|route|loading|error|not-found|default|template|opengraph-image)\.tsx?$/,
  /\/app\/(page|layout|route|loading|error|not-found|default|global-error)\.tsx?$/,
  /\/src\/(index|main)\.ts$/,
  /\/src\/proxy\.ts$/,
  /\.d\.ts$/,
  /\.(test|stories|e2e)\.tsx?$/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(repo, r)));
// Every file whose import keeps a file alive: sources, stories, configs and scripts. Not tests:
// a file only a test imports is dead code with a test.
const readers = [
  ...files,
  ...ROOTS.flatMap((r) => {
    const all = [];
    const visit = (dir) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', '.next', 'test', 'e2e'].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (SOURCE.test(name) && !files.includes(path)) all.push(path);
      }
    };
    visit(join(repo, r));
    return all;
  }),
  ...walk(join(repo, 'scripts')),
  ...readdirSync(join(repo, 'apps/web'))
    .filter((n) => /\.(ts|mjs|js)$/.test(n))
    .map((n) => join(repo, 'apps/web', n)),
  ...walk(join(repo, 'apps/web/.storybook')).filter(Boolean),
];
const text = new Map(readers.map((f) => [f, readFileSync(f, 'utf8')]));

const unused = files.filter((file) => {
  if (ENTRY.some((pattern) => pattern.test(file))) return false;
  const body = text.get(file) ?? '';
  if (/unused-files: keep/.test(body)) return false;
  const stem = basename(file, extname(file));
  // `./stem.ts`, `./stem`, `@/components/stem`, `../lib/stem'`, `dir/stem"`
  const ref = new RegExp(`[/'"]${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.(ts|tsx|mjs|js))?['"]`);
  for (const [other, body2] of text) if (other !== file && ref.test(body2)) return false;
  return true;
});

if (unused.length) {
  console.error(`Files no other file imports (${unused.length}):`);
  for (const f of unused) console.error(`  ${relative(repo, f)}`);
  console.error('Delete them, or add `// unused-files: keep <reason>` to keep one on purpose.');
  process.exit(1);
}
console.log(`unused-files: ${files.length} files, all imported.`);
