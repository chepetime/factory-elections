// Host-side storage adapter: Postgres state and S3 artifacts. Containers own persisted bytes.
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { Client, Pool } from 'pg';
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { Project, TaskRecord, type TaskRecord as Task } from '@factory/core';
import * as fs from '@factory/adapters-fs';
import { SCHEMA } from './schema.ts';

export const StorageConfig = z.object({
  kind: z.literal('postgres-s3'),
  databaseUrl: z.url(),
  endpoint: z.url(),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});
export type StorageConfig = z.infer<typeof StorageConfig>;
export interface ArtifactWriter {
  append(text: string | Buffer, event?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export class DataStorage {
  readonly root: string;
  readonly config?: StorageConfig;
  readonly pool?: Pool;
  readonly s3?: S3Client;
  readonly tasks: fs.TaskStore;
  readonly projects: fs.ProjectStore;
  private ready?: Promise<void>;
  isClosed = false;
  constructor(root: string, config?: StorageConfig) {
    this.root = resolve(root);
    this.config = config;
    if (config) {
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10_000,
        allowExitOnIdle: true,
        options: '-c statement_timeout=15000',
      });
      this.pool.on('error', () => {
        process.stderr.write('Postgres idle connection failed; new operations will reconnect.\n');
      });
      this.s3 = new S3Client({
        endpoint: config.endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        maxAttempts: 2,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        requestHandler: { connectionTimeout: 3000, requestTimeout: 10_000 },
      });
      this.tasks = new PgTasks(this);
      this.projects = new PgProjects(this);
    } else {
      this.tasks = new fs.TaskStore(this.root);
      this.projects = new fs.ProjectStore(this.root);
    }
  }
  init(): Promise<void> {
    return (this.ready ??= this.initialize().catch((error) => {
      this.ready = undefined;
      throw error;
    }));
  }
  private async initialize() {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-schema',0))");
      await client.query(SCHEMA);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async check(): Promise<void> {
    await this.init();
    if (this.s3) await this.s3.send(new HeadBucketCommand({ Bucket: this.config!.bucket }));
  }
  async health(): Promise<{ postgres: 'available' | 'unavailable'; artifacts: 'available' | 'unavailable' }> {
    if (!this.pool || !this.s3) return { postgres: 'unavailable', artifacts: 'unavailable' };
    const [postgres, artifacts] = await Promise.all([
      this.pool.query('SELECT 1').then(
        () => 'available' as const,
        () => 'unavailable' as const,
      ),
      this.s3
        .send(new HeadBucketCommand({ Bucket: this.config!.bucket }), {
          abortSignal: AbortSignal.timeout(1000),
        })
        .then(
          () => 'available' as const,
          () => 'unavailable' as const,
        ),
    ]);
    return { postgres, artifacts };
  }
  key(path: string): string {
    const key = relative(this.root, resolve(path));
    if (!key || key.startsWith(`..${sep}`) || key === '..' || key.startsWith('/'))
      throw new Error('Storage path must be inside data root');
    return key.split(sep).join('/');
  }
  async readDocument(path: string): Promise<unknown> {
    if (!this.pool) return JSON.parse(await readFile(path, 'utf8'));
    await this.init();
    const row = (await this.pool.query('SELECT data FROM factory_documents WHERE path=$1', [this.key(path)]))
      .rows[0];
    if (!row) throw Object.assign(new Error(`Record not found: ${this.key(path)}`), { code: 'ENOENT' });
    return row.data;
  }
  async writeDocument(path: string, data: unknown): Promise<void> {
    await this.writeDocuments([[path, data]]);
  }
  async writeDocuments(entries: [string, unknown][]): Promise<void> {
    if (!this.pool) {
      for (const [path, data] of entries) await fs.writeJsonAtomic(path, data);
      return;
    }
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [path, data] of entries) {
        const key = this.key(path);
        const kind = key.endsWith('/run.json') ? 'run' : key.endsWith('/team.json') ? 'team' : 'pointer';
        await client.query(
          `INSERT INTO factory_documents(path,kind,data) VALUES($1,$2,$3)
          ON CONFLICT(path) DO UPDATE SET data=excluded.data,updated_at=now()`,
          [key, kind, JSON.stringify(data)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  writer(path: string): ArtifactWriter {
    if (!this.pool || !this.s3) throw new Error('Remote artifact writer requires configured storage');
    const storage = { pool: this.pool, s3: this.s3, config: this.config, init: this.init.bind(this) };
    const stream = this.key(path);
    let sequence = 0;
    let pending: { text: string | Buffer; event?: Record<string, unknown> }[] = [];
    let bytes = 0;
    let failure: unknown;
    let chain = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          void writer.flush().catch(() => {});
        }, 100);
        timer.unref();
      }
    };
    const writer: ArtifactWriter = {
      append(text, event) {
        if (failure) throw failure;
        bytes += Buffer.byteLength(text);
        if (bytes > 8 * 1024 * 1024)
          throw new Error('Artifact upload backlog exceeded 8 MiB; storage is too slow');
        pending.push({ text, event });
        schedule();
      },
      async flush() {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        const batch = pending;
        pending = [];
        if (!batch.length) {
          await chain;
          return;
        }
        chain = chain
          .then(async () => {
            if (failure) throw failure;
            await storage.init();
            if (sequence === 0)
              sequence = Number(
                (
                  await storage.pool!.query(
                    'SELECT coalesce(max(sequence),0) AS n FROM factory_artifacts WHERE stream=$1',
                    [stream],
                  )
                ).rows[0].n,
              );
            for (const item of batch) {
              // Logs may be large: chunk payloads, preserving byte order and bounded tail reads.
              const content = Buffer.from(item.text);
              for (let offset = 0; offset < content.length; offset += 64 * 1024) {
                const body = content.subarray(offset, offset + 64 * 1024);
                sequence++;
                const sha256 = createHash('sha256').update(body).digest('hex');
                const objectKey = `${stream}/${String(sequence).padStart(12, '0')}-${sha256}.part`;
                await storage.s3!.send(
                  new PutObjectCommand({ Bucket: storage.config!.bucket, Key: objectKey, Body: body }),
                );
                const client = await storage.pool!.connect();
                try {
                  await client.query('BEGIN');
                  await client.query(
                    'INSERT INTO factory_artifacts(stream,sequence,object_key,bytes,sha256) VALUES($1,$2,$3,$4,$5)',
                    [stream, sequence, objectKey, body.length, sha256],
                  );
                  if (item.event && offset === 0) {
                    const { message: _message, ...metadata } = item.event;
                    await client.query(
                      'INSERT INTO factory_trace_events(stream,sequence,run_id,kind,data) VALUES($1,$2,$3,$4,$5)',
                      [
                        stream,
                        sequence,
                        String(metadata.run_id),
                        String(metadata.kind),
                        JSON.stringify(metadata),
                      ],
                    );
                  }
                  await client.query('COMMIT');
                } catch (error) {
                  await client.query('ROLLBACK');
                  throw error;
                } finally {
                  client.release();
                }
              }
              bytes -= content.length;
            }
          })
          .catch((error) => {
            failure = error;
            throw error;
          });
        await chain;
      },
    };
    return writer;
  }
  async artifactBytes(path: string, limit = 32_000): Promise<Buffer | undefined> {
    await this.init();
    if (!this.pool || !this.s3) throw new Error('Remote artifact storage is not configured');
    const rows = (
      await this.pool.query(
        `SELECT object_key,sha256 FROM (
      SELECT object_key,sha256,sequence,sum(bytes) OVER(ORDER BY sequence DESC)-bytes AS preceding_bytes
      FROM factory_artifacts WHERE stream=$1
    ) chunks WHERE preceding_bytes < $2 ORDER BY sequence`,
        [this.key(path), limit],
      )
    ).rows;
    if (!rows.length) return undefined;
    const parts: Buffer[] = [];
    for (const row of rows) {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.config!.bucket, Key: row.object_key }),
      );
      const body = Buffer.from(await response.Body!.transformToByteArray());
      if (createHash('sha256').update(body).digest('hex') !== row.sha256)
        throw new Error('Artifact checksum mismatch');
      parts.push(body);
    }
    const bytes = Buffer.concat(parts);
    return bytes.subarray(Math.max(0, bytes.length - limit));
  }
  async artifactTail(path: string, limit = 32_000): Promise<string | undefined> {
    return (await this.artifactBytes(path, limit))?.toString('utf8');
  }
  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    await this.pool?.end();
    this.s3?.destroy();
  }
}

class PgProjects extends fs.ProjectStore {
  readonly storage: DataStorage;
  constructor(storage: DataStorage) {
    super(storage.root);
    this.storage = storage;
  }
  override async add(name: string, repo: string): Promise<Project> {
    fs.checkProjectName(name);
    await fs.checkRepoDirectory(repo);
    await this.storage.init();
    const project = Project.parse({ name, repo });
    try {
      await this.storage.pool!.query('INSERT INTO factory_projects(name,data) VALUES($1,$2)', [
        name,
        JSON.stringify(project),
      ]);
    } catch (error) {
      if ((error as { code: string }).code === '23505')
        throw new fs.FactoryError(`project already exists: ${name}`);
      throw error;
    }
    return project;
  }
  override async read(name: string): Promise<Project> {
    fs.checkProjectName(name);
    await this.storage.init();
    const row = (await this.storage.pool!.query('SELECT data FROM factory_projects WHERE name=$1', [name]))
      .rows[0];
    if (!row) throw new fs.FactoryError(`project record not found: ${name}`);
    return Project.parse(row.data);
  }
  override async list(): Promise<Project[]> {
    await this.storage.init();
    return (await this.storage.pool!.query('SELECT data FROM factory_projects ORDER BY name')).rows.map(
      (row) => Project.parse(row.data),
    );
  }
}
class PgTasks extends fs.TaskStore {
  readonly storage: DataStorage;
  constructor(storage: DataStorage) {
    super(storage.root);
    this.storage = storage;
  }
  override async create(
    project: string,
    repo: string,
    prompt: string,
    now: string,
    jiraKey?: string,
  ): Promise<Task> {
    fs.checkProjectName(project);
    await fs.checkRepoDirectory(repo);
    const task = TaskRecord.parse({
      id: randomUUID(),
      project,
      repo,
      prompt,
      ...(jiraKey ? { jira_key: jiraKey } : {}),
      stage: 'queued',
      created_at: now,
      updated_at: now,
      events: [{ at: now, kind: 'stage:queued', message: 'Task submitted' }],
    });
    await this.storage.init();
    await this.storage.pool!.query('INSERT INTO factory_tasks(project,id,data) VALUES($1,$2,$3)', [
      project,
      task.id,
      JSON.stringify(task),
    ]);
    return task;
  }
  override async read(project: string, id: string): Promise<Task> {
    fs.checkProjectName(project);
    fs.checkTaskId(id);
    await this.storage.init();
    const row = (
      await this.storage.pool!.query('SELECT data FROM factory_tasks WHERE project=$1 AND id=$2', [
        project,
        id,
      ])
    ).rows[0];
    if (!row) throw new fs.FactoryError(`task record not found: ${project}/${id}`);
    return TaskRecord.parse(row.data);
  }
  override async write(task: Task): Promise<void> {
    const checked = TaskRecord.parse(task);
    await this.storage.init();
    const result = await this.storage.pool!.query(
      'UPDATE factory_tasks SET data=$3 WHERE project=$1 AND id=$2',
      [checked.project, checked.id, JSON.stringify(checked)],
    );
    if (!result.rowCount) throw new fs.FactoryError(`task record not found: ${checked.id}`);
  }
  override async list(project: string): Promise<Task[]> {
    fs.checkProjectName(project);
    await this.storage.init();
    return (
      await this.storage.pool!.query('SELECT data FROM factory_tasks WHERE project=$1 ORDER BY id', [project])
    ).rows.map((row) => TaskRecord.parse(row.data));
  }
  override async delete(project: string, id: string, before?: (task: Task) => Promise<void>): Promise<void> {
    fs.checkProjectName(project);
    fs.checkTaskId(id);
    const release = await this.acquireLock(project, id);
    try {
      await before?.(await this.read(project, id));
      const prefix = `${this.storage.key(join(this.storage.root, project, 'tasks', id))}/`;
      const client = await this.storage.pool!.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM factory_tasks WHERE project=$1 AND id=$2', [project, id]);
        await client.query('DELETE FROM factory_documents WHERE starts_with(path, $1)', [prefix]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await rm(join(this.storage.root, project, 'tasks', id), { recursive: true, force: true });
    } finally {
      await release();
    }
  }
  /** Advisory locks end with the session that held them, so there is never a dead lock to clear. */
  override async clearDeadLock(): Promise<boolean> {
    return false;
  }

  override async acquireLock(project: string, id: string): Promise<() => Promise<void>> {
    await this.read(project, id);
    const connection = new Client({
      connectionString: this.storage.config!.databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    let lost = false;
    connection.on('error', () => {
      lost = true;
    });
    await connection.connect();
    try {
      const result = await connection.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
        [`factory-task:${project}:${id}`],
      );
      if (!result.rows[0].acquired) throw new fs.FactoryError('task is locked by another command');
    } catch (error) {
      await connection.end();
      throw error;
    }
    return async () => {
      try {
        if (!lost)
          await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            `factory-task:${project}:${id}`,
          ]);
      } finally {
        await connection.end();
      }
    };
  }
}
const cached = new Map<string, { serialized: string; storage: DataStorage }>();
export function storageFor(root: string): DataStorage {
  let serialized = '';
  try {
    serialized = readFileSync(join(root, 'storage.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const existing = cached.get(resolve(root));
  if (existing?.serialized === serialized && !existing.storage.isClosed) return existing.storage;
  const config = serialized ? StorageConfig.parse(JSON.parse(serialized)) : undefined;
  const storage = new DataStorage(root, config);
  cached.set(resolve(root), { serialized, storage });
  return storage;
}
