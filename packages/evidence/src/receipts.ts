// Evidence receipts (packages/core/src/receipt.ts), signed with this install's Ed25519 key.
// The signature shows that this Factory install wrote the receipt and that nobody changed it
// since. It is not a third-party attestation: whoever holds the data root holds the key.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalJson,
  parseModelRef,
  Receipt,
  ReceiptBody,
  receiptClaims,
  TESTED_RUNTIMES,
  type CallManifest,
  type ModelRun,
  type TaskRecord,
} from '@factory/core';

/** What one model call was given, with no secret values. Calls with equal settings share one entry. */
export function callManifest(request: ModelRun): CallManifest {
  const provider = parseModelRef(request.model).provider;
  return {
    ...(request.step ? { step: request.step } : {}),
    provider,
    model: request.model,
    effort: request.effort,
    tools: request.tools,
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(request.sandbox?.allowed_domains?.length
      ? { sandbox_domains: [...request.sandbox.allowed_domains] }
      : {}),
    mcp: Boolean(request.mcp),
    guarded: Boolean(request.guard),
    resume: Boolean(request.resume),
    ...(request.maxBudgetUsd !== undefined ? { budget_usd: request.maxBudgetUsd } : {}),
    ...(request.timeoutMs !== undefined ? { timeout_ms: request.timeoutMs } : {}),
    ...(request.stallMs !== undefined ? { stall_ms: request.stallMs } : {}),
    env_names: Object.keys(request.env ?? {}).sort(),
    system_prompt_sha256: createHash('sha256').update(request.systemPrompt).digest('hex'),
    runtime:
      provider === 'claude'
        ? `claude-agent-sdk ${TESTED_RUNTIMES.claudeAgentSdk} (Claude Code ${TESTED_RUNTIMES.claudeSdkCli})`
        : `codex-cli ${TESTED_RUNTIMES.codexCli} (tested)`,
    calls: 1,
  };
}

/** Adds one call to a run's manifests: equal settings count as one entry with more calls. */
export function withManifest(manifests: readonly CallManifest[], next: CallManifest): CallManifest[] {
  const key = (m: CallManifest) => canonicalJson({ ...m, calls: 0 });
  const at = manifests.findIndex((m) => key(m) === key(next));
  if (at < 0) return [...manifests, next].slice(-100);
  return manifests.map((m, i) => (i === at ? { ...m, calls: m.calls + 1 } : m));
}

export const digestOf = (body: ReceiptBody) => createHash('sha256').update(canonicalJson(body)).digest('hex');

export interface ReceiptCheck {
  ok: boolean;
  /** One line per check, each starting with `ok` or `FAIL`. */
  lines: string[];
}

export class ReceiptKeys {
  readonly dir: string;
  constructor(root: string) {
    this.dir = join(root, 'receipt-key');
  }
  /** The install's key pair; created on first use, private key readable only by the user. */
  async load(): Promise<{ privateKey: string; publicKey: string }> {
    try {
      return {
        privateKey: await readFile(join(this.dir, 'private.pem'), 'utf8'),
        publicKey: await readFile(join(this.dir, 'public.pem'), 'utf8'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(this.dir, 'private.pem'), privateKey, { mode: 0o600, flag: 'wx' });
    await writeFile(join(this.dir, 'public.pem'), publicKey, { mode: 0o644, flag: 'wx' });
    return { privateKey, publicKey };
  }
}

/** Builds and signs the receipt of a task at `headSha`, from its evidence and its runs' manifests. */
export async function issueReceipt(
  keys: ReceiptKeys,
  task: TaskRecord,
  headSha: string,
  manifests: CallManifest[],
  now = new Date().toISOString(),
): Promise<Receipt> {
  const body: ReceiptBody = {
    version: 1,
    project: task.project,
    task_id: task.id,
    head_sha: headSha,
    issued_at: now,
    claims: receiptClaims(task, headSha),
    manifests,
  };
  const digest = digestOf(body);
  const { privateKey, publicKey } = await keys.load();
  const signature = sign(null, Buffer.from(digest), createPrivateKey(privateKey)).toString('base64');
  return { ...body, digest, signature, public_key: publicKey };
}

/**
 * Checks a receipt: its shape, digest and signature, that it was signed by `trustedKey` when one
 * is given, and that the commit it covers is still the head. `rerun` reports a fresh run of the
 * checks at the same commit, when the caller ran them.
 */
export function checkReceipt(
  raw: unknown,
  options: { currentHead?: string; trustedKey?: string; rerun?: { passed: boolean; detail: string } },
): ReceiptCheck {
  const lines: string[] = [];
  const parsed = Receipt.safeParse(raw);
  if (!parsed.success) return { ok: false, lines: [`FAIL  shape: ${parsed.error.issues[0]?.message}`] };
  const r = parsed.data;
  const { digest, signature, public_key, ...rest } = r;
  const body = ReceiptBody.parse(rest);
  const digestOk = digestOf(body) === digest;
  lines.push(
    digestOk ? 'ok    digest matches the receipt' : 'FAIL  digest: the receipt was changed after signing',
  );
  let signed = false;
  try {
    signed = verify(null, Buffer.from(digest), createPublicKey(public_key), Buffer.from(signature, 'base64'));
  } catch {
    signed = false;
  }
  lines.push(signed ? 'ok    signature is valid' : 'FAIL  signature is not valid');
  let trusted = true;
  if (options.trustedKey !== undefined) {
    trusted = options.trustedKey.trim() === public_key.trim();
    lines.push(trusted ? "ok    signed by this install's key" : 'FAIL  signed by a different key');
  }
  let head = true;
  if (options.currentHead !== undefined) {
    head = options.currentHead === r.head_sha;
    lines.push(
      head
        ? `ok    ${r.head_sha.slice(0, 12)} is still the head`
        : `FAIL  the head moved to ${options.currentHead.slice(0, 12)}; the receipt covers ${r.head_sha.slice(0, 12)}`,
    );
  }
  let rerun = true;
  if (options.rerun) {
    rerun = options.rerun.passed;
    lines.push(`${rerun ? 'ok  ' : 'FAIL'}  checks run again: ${options.rerun.detail}`);
  }
  const failed = r.claims.filter((c) => c.status === 'failed').length;
  const open = r.claims.filter((c) => c.status === 'not-proven').length;
  lines.push(
    `info  ${r.claims.length - failed - open} proven, ${open} not proven, ${failed} failed (the receipt states, it does not hide them)`,
  );
  return { ok: digestOk && signed && trusted && head && rerun, lines };
}

/** The documents a receipt needs: the task store and run records, in file or Postgres mode. */
export interface ReceiptStorage {
  readDocument(path: string): Promise<unknown>;
  writeDocument(path: string, data: unknown): Promise<void>;
  tasks: {
    read(project: string, id: string): Promise<TaskRecord>;
    taskPath(project: string, id: string): string;
  };
}

const taskDir = (storage: ReceiptStorage, project: string, id: string) =>
  join(storage.tasks.taskPath(project, id), '..');

/** The manifests of the task's latest run; empty when it has none (or predates manifests). */
async function latestManifests(
  storage: ReceiptStorage,
  project: string,
  id: string,
): Promise<CallManifest[]> {
  try {
    const dir = taskDir(storage, project, id);
    const pointer = (await storage.readDocument(join(dir, 'latest-run.json'))) as { id?: string };
    const run = (await storage.readDocument(join(dir, 'runs', String(pointer.id), 'run.json'))) as {
      manifests?: CallManifest[];
    };
    return run.manifests ?? [];
  } catch {
    return [];
  }
}

/** Issues and saves the receipt of the task at `headSha` (`receipt.json` beside the task). */
export async function saveTaskReceipt(
  root: string,
  storage: ReceiptStorage,
  project: string,
  id: string,
  headSha: string,
): Promise<Receipt> {
  const task = await storage.tasks.read(project, id);
  const receipt = await issueReceipt(
    new ReceiptKeys(root),
    task,
    headSha,
    await latestManifests(storage, project, id),
  );
  await storage.writeDocument(join(taskDir(storage, project, id), 'receipt.json'), receipt);
  return receipt;
}

/** Checks the saved receipt of a task against this install's key and the current head. */
export async function verifyTaskReceipt(
  root: string,
  storage: ReceiptStorage,
  project: string,
  id: string,
  options: { currentHead?: string; rerun?: { passed: boolean; detail: string } },
): Promise<ReceiptCheck> {
  let raw: unknown;
  try {
    raw = await storage.readDocument(join(taskDir(storage, project, id), 'receipt.json'));
  } catch {
    return { ok: false, lines: ['FAIL  the task has no receipt; run `factory receipt issue` first'] };
  }
  const { publicKey } = await new ReceiptKeys(root).load();
  return checkReceipt(raw, { ...options, trustedKey: publicKey });
}
