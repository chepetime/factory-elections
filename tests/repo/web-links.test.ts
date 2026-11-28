// Every internal link written in the web app points at a route that exists. A link to a missing route
// (like `/agents/<id>` when agent pages live under a project) makes Next keep the old page on screen.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';

const web = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');
const app = join(web, 'app');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Route patterns from `app/`: `*` for a dynamic segment, `**` for a catch-all; groups dropped. */
const routes = files(app)
  .filter((f) => /\/(page|route)\.tsx?$/.test(f))
  .map((f) =>
    relative(app, f)
      .split(sep)
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'))
      .map((s) => (s.startsWith('[...') ? '**' : s.startsWith('[') ? '*' : s)),
  )
  .filter((r) => !r.includes('**') || r.length > 1); // the modal slot's catch-all matches nothing real

function matches(route: string[], path: string[]): boolean {
  if (route.at(-1) === '**')
    return path.length >= route.length && matches(route.slice(0, -1), path.slice(0, route.length - 1));
  return route.length === path.length && route.every((r, i) => r === '*' || path[i] === '*' || r === path[i]);
}

/** Internal links in source: `href="/…"`, href={`/…`} and router.push/redirect(`/…`). A template
 * literal is read whole, `${…}` expressions included, even when they hold quotes of their own. */
const LINK =
  /(?:href=\{?|href:\s*|\.push\(|redirect\()\s*(?:`(\/(?:[^`$]|\$\{[^}]*\}|\$)*)`|["'](\/[^"']*)["'])/g;

test('every internal link in the web app points at an existing route', () => {
  const broken: string[] = [];
  for (const file of files(web).filter((f) => /\.tsx?$/.test(f) && !f.includes(`${sep}stories${sep}`))) {
    for (const [, template, plain] of readFileSync(file, 'utf8').matchAll(LINK)) {
      const raw = template ?? plain!;
      const path = raw.replace(/\$\{[^}]*\}/g, '*').split(/[?#]/)[0]!;
      if (path.startsWith('/api/') || path === '/') continue;
      // A template expression is one segment we cannot know: it matches any.
      const parts = path
        .split('/')
        .filter(Boolean)
        .map((p) => (p.includes('*') ? '*' : p));
      if (!routes.some((r) => matches(r, parts))) broken.push(`${relative(web, file)}: ${raw}`);
    }
  }
  assert.deepEqual(broken, []);
});
