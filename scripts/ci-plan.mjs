import { readdirSync, readFileSync, appendFileSync, globSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function workspaces(root = '.') {
  const packages = ['packages', 'apps'].flatMap((parent) =>
    readdirSync(resolve(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = `${parent}/${entry.name}`;
        const manifest = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
        return {
          path,
          name: manifest.name,
          dependencies: Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
            ...manifest.peerDependencies,
          }),
        };
      }),
  );
  // Some integration tests import a sibling workspace without declaring it.
  for (const pkg of packages) {
    for (const file of globSync(`${pkg.path}/{src,test}/**/*.{ts,tsx,js,mjs}`, { cwd: root })) {
      const source = readFileSync(resolve(root, file), 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g)) {
        const target = resolve(root, dirname(file), match[1]);
        const owner = packages.find((candidate) => target.startsWith(`${resolve(root, candidate.path)}/`));
        if (owner && owner.name !== pkg.name && !pkg.dependencies.includes(owner.name))
          pkg.dependencies.push(owner.name);
      }
    }
  }
  return packages;
}

export function planChanges(files, packages = workspaces()) {
  const selected = new Set();
  let full = false;
  for (const file of files) {
    // Only human documentation is inert; definitions/*.md can be executable prompts.
    if (
      (file.startsWith('docs/') && file.endsWith('.md')) ||
      /^[^/]+\.md$/.test(file) ||
      /(?:^|\/)AGENTS\.md$/.test(file)
    )
      continue;
    const owner = packages.find((pkg) => file.startsWith(`${pkg.path}/`));
    if (owner) selected.add(owner.name);
    else full = true; // Unknown/shared inputs fail closed, including deleted workspaces.
  }
  if (full) for (const pkg of packages) selected.add(pkg.name);
  let previous;
  do {
    previous = selected.size;
    for (const pkg of packages)
      if (pkg.dependencies.some((name) => selected.has(name))) selected.add(pkg.name);
  } while (previous !== selected.size);
  const affected = packages.filter((pkg) => selected.has(pkg.name));
  return {
    full,
    packages: affected.map((pkg) => pkg.path),
    code: affected.length > 0,
    web: selected.has('@factory/web'),
  };
}

export function changedFiles(base, head = 'HEAD', direct = false) {
  if (base === '--all') return ['package.json'];
  if (!base) throw new Error('Pass a base commit: node scripts/ci-plan.mjs <base> [head] [--direct]');
  return execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      direct ? base : `${base}...${head}`,
      ...(direct ? [head] : []),
      '--',
    ],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = planChanges(
    changedFiles(process.argv[2], process.argv[3] || 'HEAD', process.argv.includes('--direct')),
  );
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `code=${plan.code}\nweb=${plan.web}\n`);
}
