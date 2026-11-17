#!/usr/bin/env node
// Runs only data services in Docker; applications stay on the host.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dataRoot } from '../packages/adapters-fs/src/index.ts';
import { DataStorage } from '../packages/adapters-data/src/index.ts';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(repo, '.factory-data.env');
const action = process.argv[2] ?? 'status';
let env;
try {
  env = parseEnv(await readFile(envFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT' || action !== 'up') throw error;
  env = {
    POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
    S3_ACCESS_KEY: randomBytes(12).toString('hex'),
    S3_SECRET_KEY: randomBytes(24).toString('hex'),
    POSTGRES_PORT: '15432',
    S3_PORT: '18333',
  };
  await writeFile(
    envFile,
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
}
const config = {
  kind: 'postgres-s3',
  databaseUrl: `postgresql://factory:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_PORT}/factory`,
  endpoint: `http://127.0.0.1:${env.S3_PORT}`,
  bucket: 'factory-artifacts',
  accessKeyId: env.S3_ACCESS_KEY,
  secretAccessKey: env.S3_SECRET_KEY,
};
function compose(args) {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', envFile, '-f', join(repo, 'compose.yaml'), ...args],
    { cwd: repo, stdio: 'inherit' },
  );
  if (result.status !== 0)
    throw new Error(`Docker Compose failed (${result.status ?? result.error?.message})`);
}
if (action === 'up') {
  compose(['up', '-d', '--wait', '--wait-timeout', '120']);
  const storage = new DataStorage(dataRoot(), config);
  try {
    let last;
    for (let i = 0; i < 60; i++) {
      try {
        await storage.check();
        last = undefined;
        break;
      } catch (error) {
        last = error;
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    if (last) throw last;
    console.log('Postgres and S3 file storage are ready. Run pnpm data:migrate to import and activate them.');
  } finally {
    await storage.close();
  }
} else if (action === 'down') compose(['down']);
else if (action === 'status') compose(['ps']);
else if (action === 'migrate') {
  const root = dataRoot();
  const { migrateFiles } = await import('../packages/adapters-data/src/migrate.ts');
  const result = await migrateFiles(root, config);
  console.log(JSON.stringify(result));
} else if (action === 'test') {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=spec', join(repo, 'packages/adapters-data/test/storage.test.ts')],
    {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, FACTORY_TEST_STORAGE: JSON.stringify(config) },
    },
  );
  process.exitCode = result.status ?? 1;
} else throw new Error('Usage: node scripts/data.mjs up|down|status|migrate|test');
