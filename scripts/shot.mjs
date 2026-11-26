#!/usr/bin/env node
// One screenshot of a page of the running app, for a visual check by a person or an agent.
// Usage: pnpm shot <path-or-url> [--selector <css>] [--out <file.png>] [--size 1440x900] [--full]
//   pnpm shot /projects/demo/tasks/DE-1?panel=details --selector '#panel-timeline'
// A path uses http://localhost:$PORT (3000). It prints the PNG path and any non-empty alert text,
// so an error on the page shows without reading the image.
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find(
  (a, i) => !a.startsWith('--') && !['--selector', '--out', '--size'].includes(args[i - 1]),
);
if (!target) {
  console.error('Usage: pnpm shot <path-or-url> [--selector <css>] [--out <file.png>] [--size WxH] [--full]');
  process.exit(2);
}
const url = /^https?:/.test(target)
  ? target
  : `http://localhost:${process.env.PORT ?? 3000}${target.startsWith('/') ? '' : '/'}${target}`;
const [width, height] = (flag('--size') ?? '1440x900').split('x').map(Number);
const out = resolve(flag('--out') ?? join(tmpdir(), `factory-shot-${Date.now()}.png`));
const selector = flag('--selector');

// Playwright is a dependency of the web app, not of the repository root.
const { chromium } = createRequire(join(repo, 'apps', 'web', 'package.json'))('playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 180_000 });
  if (selector) {
    const element = page.locator(selector).first();
    // A heading id names its section: shoot the section, not the heading.
    const section = element.locator('xpath=ancestor-or-self::section[1]');
    await ((await section.count()) ? section : element).screenshot({ path: out });
  } else await page.screenshot({ path: out, fullPage: args.includes('--full') });
  const alerts = (await page.locator('[role=alert]').allTextContents()).map((t) => t.trim()).filter(Boolean);
  console.log(`${out}  (${response?.status() ?? '?'} ${url})`);
  for (const alert of alerts) console.log(`alert: ${alert}`);
} finally {
  await browser.close();
}
