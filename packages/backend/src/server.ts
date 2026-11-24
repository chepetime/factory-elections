import { outcomeTraceIds } from '@factory/core';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Server, ServerCredentials, status, type handleUnaryCall, type ServiceError } from '@grpc/grpc-js';
import { z } from 'zod';
import { ProjectName, type ModelRunner } from '@factory/core';
import { isReadableDirectory } from '@factory/adapters-fs';
import { DriverError } from '@factory/driver';
import { BackendService, Conflict, DRAIN_GRACE_MS } from './service.ts';
import type { ReviewDeps } from './reviews.ts';
import type { SettingsDetector } from './settings.ts';
import { Evidence } from './evidence.ts';
import type { Check } from './diagnostics.ts';
import { definition, type Command, type Methods, type Target } from './protocol.ts';

export interface ServerOptions {
  root: string;
  port?: number;
  healthPort?: number;
  token?: string;
  runner?: ModelRunner;
  environment?: () => Promise<Check[]>;
  reviews?: ReviewDeps;
  detector?: SettingsDetector;
}
export async function startBackend(options: ServerOptions) {
  const { root } = options;
  await mkdir(root, { recursive: true });
  const owner = join(root, 'backend.lock');
  await writeFile(owner, `${JSON.stringify({ pid: process.pid })}\n`, { flag: 'wx', mode: 0o600 }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST')
        throw new Error(
          `Backend ownership lock exists: ${owner}. Confirm the previous backend and its workers stopped before removing it.`,
        );
      throw error;
    },
  );
  const rpc = new Server({
    'grpc.max_receive_message_length': 1024 * 1024,
    'grpc.max_send_message_length': 16 * 1024 * 1024,
  });
  const service = new BackendService(
    root,
    options.runner,
    options.environment,
    options.reviews,
    options.detector,
  );
  // Ledger scans can be expensive. Share one refresh across callers and cache it briefly.
  let ledgerCache:
    { at: number; value: Awaited<ReturnType<typeof service.traces.health>> | undefined } | undefined;
  let ledgerRefresh: Promise<void> | undefined;
  const ledgerHealth = async () => {
    if (!ledgerCache || Date.now() - ledgerCache.at >= 60_000) {
      ledgerRefresh ??= (async () => {
        try {
          const projects = await service.projects.list();
          const value = await service.traces.health(projects.map((project) => project.name));
          ledgerCache = { at: Date.now(), value };
        } catch {
          ledgerCache = { at: Date.now(), value: undefined };
        }
      })().finally(() => {
        ledgerRefresh = undefined;
      });
      await ledgerRefresh;
    }
    return ledgerCache?.value;
  };
  const health = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    try {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      const storageHealth = service.storage.config ? await service.storage.health() : undefined;
      const ledger = await ledgerHealth();
      response.end(
        JSON.stringify({
          engine: 'running',
          task_store: storageHealth?.postgres ?? (await isReadableDirectory(root)),
          telemetry_database: storageHealth?.postgres ?? 'not_configured',
          ...(storageHealth ? { artifact_store: storageHealth.artifacts } : {}),
          ...(ledger ? { ledger } : {}),
          integrations: [],
        }),
      );
    } catch {
      response.destroy();
    }
  });
  const requests = new Set<Promise<unknown>>();
  let evidence: Evidence | undefined;
  try {
    await service.storage.check();
    let token = options.token ?? process.env.FACTORY_BACKEND_TOKEN;
    if (!token) {
      const path = join(root, 'backend-token');
      try {
        await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      token = (await readFile(path, 'utf8')).trim();
    }
    if (token.length < 32) throw new Error('Backend token must contain at least 32 characters');
    const expected = Buffer.from(`Bearer ${token}`);
    const instance = randomUUID();
    await mkdir(join(root, 'logs'), { recursive: true });
    // RPC spans are diagnostics: a storage outage must not fail every request until a restart.
    evidence = new Evidence(join(root, 'logs', `${instance}.jsonl`), instance, service.storage, {
      onWriteError: (error) => service.traces.reportWriteError(error),
    });
    const trace = evidence;
    const handlers: { [K in keyof Methods]: (request: Methods[K][0]) => Promise<Methods[K][1]> } = {
      GetDiagnostics: async () => ({ json: JSON.stringify(await service.diagnostics()) }),
      ListTeamRecords: async (request) => ({
        json: JSON.stringify(await service.team.records(request.project)),
      }),
      SaveTeamRecord: async (request) => ({
        json: JSON.stringify(await service.team.saveRecord(request.project, jsonObject(request.json))),
      }),
      GetTeam: async (request) => ({ json: JSON.stringify(await service.team.members(request.project)) }),
      GetGitUser: async (request) => ({ text: await service.team.userName(request.project) }),
      UpdateMembers: async (request) => ({ json: JSON.stringify(await service.team.bulk(request)) }),
      SaveAssignment: async (request) => {
        await service.team.assign(request);
        return { text: 'Saved' };
      },
      ListProjects: async () => ({ json: JSON.stringify(await service.projectSummaries()) }),
      GetProjectSettings: async (request) => ({
        json: JSON.stringify(await service.settings.get(request.project)),
      }),
      SaveProjectSettings: async (request) => ({
        json: JSON.stringify(await service.settings.save(request)),
      }),
      DetectProjectSettings: async (request) => ({
        json: JSON.stringify(await service.settings.detect(request)),
      }),
      AddProject: async (request) => ({ json: JSON.stringify(await service.addProject(request)) }),
      GetMemory: async (request) => ({
        json: JSON.stringify(await service.memory.snapshot(ProjectName.parse(request.project))),
      }),
      ForgetFact: async (request) => {
        await service.memory.forget(
          ProjectName.parse(request.project),
          z.string().min(1).max(64).parse(request.id),
        );
        return { text: 'forgotten' };
      },
      ListFeatures: async (request) => ({
        json: JSON.stringify(await service.features.list(request.project)),
      }),
      GetFeature: async (request) => ({ json: JSON.stringify(await service.features.detail(request)) }),
      CreateFeature: async (request) => ({
        json: JSON.stringify(
          await service.features.create({ ...jsonObject(request.json), project: request.project }),
        ),
      }),
      FeatureAction: async (request) => ({
        json: JSON.stringify(
          await service.features.act({ ...jsonObject(request.json), project: request.project }),
        ),
      }),
      GetTrace: async (request) => ({
        json: JSON.stringify(await service.trace({ ...jsonObject(request.json), project: request.project })),
      }),
      GetMetrics: async (request) => ({
        json: JSON.stringify(
          await service.metrics({ ...jsonObject(request.json), project: request.project }),
        ),
      }),
      ListPrReviewRecords: async (request) => {
        await service.projects.read(request.project);
        return { json: JSON.stringify(await service.prReviewRecords.list(request.project)) };
      },
      AddPrReviewRecord: async (request) => {
        await service.projects.read(request.project);
        return {
          json: JSON.stringify(await service.prReviewRecords.add(request.project, jsonObject(request.json))),
        };
      },
      ListOutcomes: async (request) => {
        await service.projects.read(request.project);
        const [outcomes, spans] = await Promise.all([
          service.outcomes.list(request.project),
          service.traces.read(request.project),
        ]);
        return {
          json: JSON.stringify(
            outcomes.map((outcome) => ({
              ...outcome,
              trace_ids: outcomeTraceIds(outcome, request.project, spans),
            })),
          ),
        };
      },
      AddOutcome: async (request) => {
        await service.projects.read(request.project);
        return {
          json: JSON.stringify(await service.outcomes.add(request.project, jsonObject(request.json))),
        };
      },
      ListExperiments: async (request) => {
        await service.projects.read(request.project);
        return { json: JSON.stringify(await service.experiments.list(request.project)) };
      },
      AddExperiment: async (request) => {
        await service.projects.read(request.project);
        return {
          json: JSON.stringify(await service.experiments.add(request.project, jsonObject(request.json))),
        };
      },
      GetInbox: async () => ({ json: JSON.stringify(await service.inbox()) }),
      DismissInboxItem: async (request) => {
        await service.dismissInbox(jsonObject(request.json));
        return { text: 'dismissed' };
      },
      TendPullRequests: async (request) => ({ json: JSON.stringify(await service.tendNow(request)) }),
      RestoreTools: async (request) => {
        await service.memory.restoreTools(ProjectName.parse(request.project));
        return { text: 'restored' };
      },
      ListPullRequests: async (request) => ({ json: JSON.stringify(await service.reviews.list(request)) }),
      StartReviews: async (request) => ({ json: JSON.stringify(await service.reviews.start(request)) }),
      GetReview: async (request) => ({ json: JSON.stringify(await service.reviews.detail(request)) }),
      SendReviewMessage: async (request) => {
        await service.reviews.reply(request);
        return { text: 'Sent' };
      },
      StopReview: async (request) => {
        await service.reviews.stop(request);
        return { text: 'Stopped' };
      },
      RemoveReview: async (request) => {
        await service.reviews.remove(request);
        return { text: 'Removed' };
      },
      ListTickets: async (request) => ({ json: JSON.stringify(await service.tickets.list(request)) }),
      ListTasks: async (request) => ({
        json: JSON.stringify(await service.tasks.list(ProjectName.parse(request.project))),
      }),
      GetTask: async (request) => {
        const t = service.target(request);
        return { json: JSON.stringify(await service.tasks.read(t.project, t.id)) };
      },
      GetTaskControls: async (request) => ({ json: JSON.stringify(await service.controls(request)) }),
      GetGate: async (request) => {
        const t = service.target(request);
        const gate = await service.driver().gate(t.project, t.id);
        return {
          json: JSON.stringify({
            task: gate.task,
            head_sha: gate.headSha,
            diff_stat: gate.diffStat,
            blockers: gate.blockers,
          }),
        };
      },
      GetDiff: async (request) => {
        const t = service.target(request);
        return { text: await service.driver().diff(t.project, t.id) };
      },
      SubmitTask: async (request) => ({ text: await service.submit(request) }),
      ExecuteTask: async (request: Command) => ({ text: await service.execute(request) }),
      StartRun: async (request: Command) => ({ json: JSON.stringify(await service.start(request)) }),
      GetBackground: async (request: Target) => ({ json: JSON.stringify(await service.background(request)) }),
      StopRun: async (request: Target) => ({ text: await service.stopRun(request) }),
      StartProfileCheck: async (request: Target) => ({
        json: JSON.stringify(await service.profileChecks.start(ProjectName.parse(request.project))),
      }),
      GetProfileCheck: async (request: Target) => ({
        json: JSON.stringify(await service.profileChecks.get(ProjectName.parse(request.project))),
      }),
      ClearLog: async (request: Target) => {
        await service.clearLog(request);
        return { text: 'Dismissed' };
      },
    };
    const implementation: Record<string, handleUnaryCall<unknown, unknown>> = {};
    for (const name of Object.keys(handlers) as (keyof Methods)[]) {
      implementation[name] = (call, callback) => {
        const provided = Buffer.from(String(call.metadata.get('authorization')[0] ?? ''));
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          callback({ code: status.UNAUTHENTICATED, message: 'Invalid backend credential' });
          return;
        }
        // Inputs are checked by the application services, rather than trusting protobuf defaults.
        const handler = handlers[name] as (request: unknown) => Promise<unknown>;
        const execution = trace.span(`rpc.${name}`, { method: name }, () => handler(call.request));
        requests.add(execution);
        execution
          .then(
            (result) => callback(null, result),
            (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              const code =
                error instanceof z.ZodError || error instanceof SyntaxError
                  ? status.INVALID_ARGUMENT
                  : error instanceof Conflict || /locked by another command/.test(message)
                    ? status.FAILED_PRECONDITION
                    : error instanceof DriverError
                      ? status.FAILED_PRECONDITION
                      : status.INTERNAL;
              callback({
                code,
                message: error instanceof z.ZodError ? 'Invalid request' : message,
              } as ServiceError);
            },
          )
          .finally(() => requests.delete(execution));
      };
    }
    rpc.addService(definition, implementation);
    await new Promise<void>((done, reject) => {
      health.once('error', reject);
      health.listen(options.healthPort ?? 4318, '127.0.0.1', done);
    });
    const port = await new Promise<number>((done, reject) =>
      rpc.bindAsync(`127.0.0.1:${options.port ?? 4319}`, ServerCredentials.createInsecure(), (error, port) =>
        error ? reject(error) : done(port),
      ),
    );
    trace.record('server.started', { port, effect: true });
    // This process owns the data root now, so runs left by a previous backend can be settled.
    const recovered = await service.recover();
    service.reviews.startSweeping();
    service.features.startTicking();
    service.tending.startTicking();
    trace.record('server.recovered', recovered);
    const delegation = await service.delegation.start();
    trace.record('server.delegation', { url: delegation });
    let closing: Promise<void> | undefined;
    return {
      port,
      healthPort: (health.address() as { port: number }).port,
      service,
      close: () =>
        (closing ??= (async () => {
          // Stop acceptance and drain paid work. Client disconnects never cancel a run.
          await Promise.all([
            service.drain(),
            Promise.resolve(service.reviews.stopSweeping()),
            service.reviews.close(DRAIN_GRACE_MS),
            Promise.resolve(service.features.stopTicking()),
            Promise.resolve(service.tending.stopTicking()),
            new Promise<void>((done, reject) => rpc.tryShutdown((error) => (error ? reject(error) : done()))),
            new Promise<void>((done, reject) => health.close((error) => (error ? reject(error) : done()))),
          ]);
          // Runs have drained; stop review children and refuse new delegate calls.
          await service.delegation.close();
          // Timed-out RPCs may still be finishing diagnostics; preserve their traces.
          await Promise.allSettled(requests);
          trace.record('server.stopped');
          await trace.close();
          await service.storage.close();
          await rm(owner);
        })()),
    };
  } catch (error) {
    rpc.forceShutdown();
    health.close();
    await service.delegation.close();
    await evidence?.close();
    await service.storage.close();
    await rm(owner, { force: true });
    throw error;
  }
}

/** A request's JSON body as an object; a malformed body is an input error. */
function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SyntaxError('expected a JSON object');
  return value as Record<string, unknown>;
}
