// One-time, verified import. Original task files, profiles, logs and worktrees are preserved.
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { access, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ProjectStore, TaskStore } from '@factory/adapters-fs';
import { DataStorage, StorageConfig } from './index.ts';

export async function migrateFiles(root: string, rawConfig: StorageConfig) {
  const config = StorageConfig.parse(rawConfig);
  const activation = join(root, 'storage.json');
  try {
    const active = StorageConfig.parse(JSON.parse(await readFile(activation, 'utf8')));
    if (!isDeepStrictEqual(active, config))
      throw new Error('A different storage configuration is already active');
    return { alreadyActive: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const owner = join(root, 'backend.lock');
  await writeFile(owner, JSON.stringify({ pid: process.pid, mode: 'storage-migration' }), {
    flag: 'wx',
    mode: 0o600,
  });
  const storage = new DataStorage(root, config);
  let lock: PoolClient | undefined;
  let projectCount = 0;
  let taskCount = 0;
  let artifactCount = 0;
  let artifactBytes = 0;
  try {
    lock = await storage.pool!.connect();
    const acquired = await lock.query(
      "SELECT pg_try_advisory_lock(hashtextextended('factory-storage-import',0)) AS acquired",
    );
    if (!acquired.rows[0].acquired) throw new Error('Another storage import is running');
    await storage.check();
    const projects = await new ProjectStore(root).list();
    const tasks = new TaskStore(root);
    const metadata: [string, unknown][] = [];
    const artifacts: string[] = [];
    for (const project of projects) {
      await storage.pool!.query(
        'INSERT INTO factory_projects(name,data) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [project.name, JSON.stringify(project)],
      );
      if (!isDeepStrictEqual(await storage.projects.read(project.name), project))
        throw new Error(`Existing project differs: ${project.name}`);
      projectCount++;
      try {
        metadata.push([
          join(root, project.name, 'team.json'),
          JSON.parse(await readFile(join(root, project.name, 'team.json'), 'utf8')),
        ]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (const task of await tasks.list(project.name)) {
        const dir = join(root, project.name, 'tasks', task.id);
        try {
          await access(join(dir, 'command.lock'));
          throw new Error(
            `Task ${task.id} has an ownership lock; confirm its worker stopped before importing`,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await storage.pool!.query(
          'INSERT INTO factory_tasks(project,id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [project.name, task.id, JSON.stringify(task)],
        );
        if (!isDeepStrictEqual(await storage.tasks.read(project.name, task.id), task))
          throw new Error(`Existing task differs: ${task.id}`);
        taskCount++;
        for (const file of await readdir(dir, { withFileTypes: true })) {
          if (file.isFile() && file.name === 'latest-run.json')
            metadata.push([join(dir, file.name), JSON.parse(await readFile(join(dir, file.name), 'utf8'))]);
          else if (
            file.isFile() &&
            !['task.json', 'web-run.json'].includes(file.name) &&
            !file.name.endsWith('.tmp')
          )
            artifacts.push(join(dir, file.name));
          else if (file.isDirectory() && file.name === 'runs') {
            for (const run of await readdir(join(dir, 'runs'), { withFileTypes: true })) {
              if (!run.isDirectory()) continue;
              for (const entry of await readdir(join(dir, 'runs', run.name), { withFileTypes: true })) {
                if (!entry.isFile()) continue;
                const path = join(dir, 'runs', run.name, entry.name);
                if (entry.name === 'run.json')
                  metadata.push([path, JSON.parse(await readFile(path, 'utf8'))]);
                else artifacts.push(path);
              }
            }
          }
        }
      }
    }
    try {
      for (const file of await readdir(join(root, 'logs'), { withFileTypes: true }))
        if (file.isFile()) artifacts.push(join(root, 'logs', file.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const [path, data] of metadata) {
      let existing;
      try {
        existing = await storage.readDocument(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (existing !== undefined && !isDeepStrictEqual(existing, data))
        throw new Error(`Existing metadata differs: ${storage.key(path)}`);
    }
    await storage.writeDocuments(metadata);
    for (const path of artifacts) {
      const stream = storage.key(path);
      const exists = await storage.pool!.query(
        'SELECT coalesce(sum(bytes),0) AS bytes FROM factory_artifacts WHERE stream=$1',
        [stream],
      );
      const previous = Number(exists.rows[0].bytes);
      // A failed partial import is resumable only after an exact prefix check.
      const source = await readFile(path);
      if (previous > source.length) throw new Error(`Artifact differs: ${stream}`);
      if (previous) {
        const remote = await storage.artifactBytes(path, previous);
        if (!remote?.equals(source.subarray(0, previous)))
          throw new Error(`Artifact prefix differs: ${stream}`);
      }
      const writer = storage.writer(path);
      for (let offset = previous; offset < source.length; offset += 64 * 1024) {
        writer.append(source.subarray(offset, offset + 64 * 1024));
        await writer.flush();
      }
      const remote = await storage.artifactBytes(path, source.length || 1);
      if (
        source.length &&
        (!remote ||
          createHash('sha256').update(remote).digest('hex') !==
            createHash('sha256').update(source).digest('hex'))
      )
        throw new Error(`Artifact verification failed: ${stream}`);
      artifactCount++;
      artifactBytes += source.length;
    }
    const manifest = {
      at: new Date().toISOString(),
      projects: projectCount,
      tasks: taskCount,
      artifacts: artifactCount,
      artifactBytes,
    };
    await storage.writeDocument(join(root, 'migration-manifest.json'), manifest);
    const tmp = `${activation}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(tmp, activation);
    return manifest;
  } finally {
    await lock
      ?.query("SELECT pg_advisory_unlock(hashtextextended('factory-storage-import',0))")
      .catch(() => {});
    lock?.release();
    await storage.close();
    await rm(owner, { force: true });
  }
}
