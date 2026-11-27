#!/usr/bin/env node
// Complexity ratchet: no function in production source may exceed a cyclomatic complexity of 15, and a
// file already over (listed in complexity-baseline.json with its worst function) may only improve.
// Part of `pnpm lint`. Reuses the file-size ratchet's compare/update logic with a different metric.
// Usage: node scripts/complexity-ratchet.mjs            check (exit 1 on a violation)
//        node scripts/complexity-ratchet.mjs --update   lower baseline entries of improved files
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, nextBaseline } from './file-size-ratchet-core.mjs';
import { changedPaths, formatBaseline, isProduction } from './file-size-ratchet.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = 'complexity-baseline.json';
export const MAX = 15;
const MESSAGE = /has a complexity of (\d+)\./;

/** `{ path: worst complexity }` for production files with a function over the cap, from oxlint JSON. */
export function worstPerFile(diagnostics) {
  const worst = {};
  for (const d of diagnostics) {
    const match = MESSAGE.exec(d.message ?? '');
    if (!match || !isProduction(d.filename)) continue;
    worst[d.filename] = Math.max(worst[d.filename] ?? 0, Number(match[1]));
  }
  return worst;
}

function measure() {
  const dir = mkdtempSync(join(tmpdir(), 'complexity-'));
  try {
    const config = join(dir, 'oxlint.json');
    writeFileSync(
      config,
      JSON.stringify({
        rules: { complexity: ['warn', { max: MAX }] },
        ignorePatterns: [
          'plain_modules/**',
          'dist/**',
          '**/.next/**',
          '**/.source/**',
          '**/storybook-static/**',
        ],
      }),
    );
    const bin = join(repo, 'node_modules', '.bin', 'oxlint');
    let out;
    try {
      out = execFileSync(bin, ['-c', config, '--format', 'json', 'apps', 'packages', 'scripts'], {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      out = error.stdout;
      if (!out) throw error;
    }
    return worstPerFile(JSON.parse(out).diagnostics);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readBaseline() {
  const file = join(repo, BASELINE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

function printViolations(violations) {
  console.error(`Complexity ratchet: ${violations.length} file(s) over their limit:`);
  for (const v of violations) {
    const why = v.kind === 'new' ? `over the cap of ${MAX}` : `worsened past its baseline of ${v.allowed}`;
    console.error(`  ${v.path}: complexity ${v.lines}, ${why}`);
  }
  console.error(
    'Split the function into smaller ones. Do not raise the baseline.\n' +
      `If the file was renamed or moved, move its entry in ${BASELINE} to the new path by hand.`,
  );
}

function main(argv) {
  const worst = measure();
  const baseline = readBaseline();
  // Files with no function over the cap are absent from `worst`; give baselined ones the cap so they improve.
  const scores = { ...worst };
  for (const path of Object.keys(baseline))
    if (!(path in scores) && existsSync(join(repo, path))) scores[path] = MAX;
  const { violations, improved } = compare(scores, baseline, MAX);
  if (violations.length) {
    printViolations(violations);
    return 1;
  }
  if (argv.includes('--update')) {
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const next = nextBaseline(scores, baseline, changedPaths(branch, baseline), MAX);
    writeFileSync(join(repo, BASELINE), formatBaseline(next));
    console.log(`complexity: baseline updated (${Object.keys(next).length} files over the cap).`);
    return 0;
  }
  if (improved.length) {
    console.log('complexity: these files improved below their baseline entry:');
    for (const f of improved) console.log(`  ${f.path}: ${f.lines} (baseline ${f.allowed})`);
    console.log('Lower the entries with `node scripts/complexity-ratchet.mjs --update`.');
  }
  console.log(`complexity: ${Object.keys(worst).length} files over ${MAX}, none worse than the baseline.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
