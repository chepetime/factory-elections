#!/usr/bin/env node
// File-size ratchet: no production source file may exceed 1000 lines, and a file already over the cap
// (listed in file-size-baseline.json) may only shrink. Part of `pnpm lint`.
// Usage: node scripts/file-size-ratchet.mjs            check (exit 1 on a violation)
//        node scripts/file-size-ratchet.mjs --update   lower baseline entries of shrunk files
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, countLines, nextBaseline } from './file-size-ratchet-core.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = 'file-size-baseline.json';
const ROOTS = ['apps', 'packages', 'scripts'];
const SOURCE = /\.(ts|tsx|mjs|js)$/;

/** Production source: not a test, story, e2e file, declaration file or docs/vendored tree. */
export function isProduction(path) {
  if (!SOURCE.test(path)) return false;
  if (path.includes('/test/') || path.includes('/e2e/')) return false;
  if (/\.(test|stories)\.[^/]*$/.test(path) || path.endsWith('.d.ts')) return false;
  return !path.startsWith('apps/docs/') && !path.startsWith('packages/affect-ui/upstream/');
}

/** `{ path: lines }` for the production files among `files`; files `readFile` cannot read are skipped. */
export function measure(files, readFile) {
  const sizes = {};
  for (const path of files.filter(isProduction)) {
    const text = readFile(path);
    if (text !== null && text !== undefined) sizes[path] = countLines(text);
  }
  return sizes;
}

/** The baseline after `--update`, given the current sizes and the paths this branch changed. */
export function updateBaseline(sizes, baseline, changed) {
  return nextBaseline(sizes, baseline, changed);
}

/** Baseline file text: sorted by path, Prettier's JSON layout, one blank line between entries. */
export function formatBaseline(baseline) {
  const entries = Object.keys(baseline)
    .sort()
    .map((path) => `  ${JSON.stringify(path)}: ${baseline[path]}`);
  return entries.length ? `{\n${entries.join(',\n\n')}\n}\n` : '{}\n';
}

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const lines = (text) => text.split('\n').filter(Boolean);

function readSource(path) {
  const full = join(repo, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function readBaseline() {
  const file = join(repo, BASELINE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** Paths to move in `--update`: everything on main, only the branch's own changes elsewhere. */
export function changedPaths(branch, baseline, run = git) {
  if (branch === 'main') return Object.keys(baseline);
  return [
    ...new Set([
      ...lines(run('diff', '--name-only', '--no-renames', 'main...HEAD')),
      ...lines(run('diff', '--name-only', 'HEAD')),
    ]),
  ];
}

function main(argv) {
  const sizes = measure(lines(git('ls-files', ...ROOTS)), readSource);
  const baseline = readBaseline();
  const { violations, improved } = compare(sizes, baseline);
  if (argv.includes('--update')) {
    if (violations.length) {
      printViolations(violations);
      console.error('file-size: refusing to update the baseline while there are violations.');
      return 1;
    }
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const next = updateBaseline(sizes, baseline, changedPaths(branch, baseline));
    writeFileSync(join(repo, BASELINE), formatBaseline(next));
    console.log(`file-size: baseline updated (${Object.keys(next).length} files over the cap).`);
    return 0;
  }
  if (violations.length) {
    printViolations(violations);
    return 1;
  }
  if (improved.length) {
    console.log('file-size: these files shrank below their baseline entry:');
    for (const f of improved) console.log(`  ${f.path}: ${f.lines} lines (baseline ${f.allowed})`);
    console.log('Lower the entries with `node scripts/file-size-ratchet.mjs --update`.');
  }
  console.log(`file-size: ${Object.keys(sizes).length} files, none over the cap that is not baselined.`);
  return 0;
}

function printViolations(violations) {
  console.error(`File-size ratchet: ${violations.length} file(s) over their limit:`);
  for (const v of violations) {
    const why =
      v.kind === 'new' ? `over the ${v.allowed}-line cap` : `grew past its baseline of ${v.allowed}`;
    console.error(`  ${v.path}: ${v.lines} lines, ${why}`);
  }
  console.error(
    'Move a cohesive part of the file into its own module. Do not raise the baseline.\n' +
      `If the file was renamed or moved, move its entry in ${BASELINE} to the new path by hand.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
