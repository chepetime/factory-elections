import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelRun, TaskRecord } from '@factory/core';
import { callManifest, checkReceipt, issueReceipt, ReceiptKeys, withManifest } from '../src/receipts.ts';

const head = 'a'.repeat(40);
const task = {
  id: '11111111-1111-4111-8111-111111111111',
  project: 'demo',
  repo: '/r',
  prompt: 'x',
  stage: 'approved',
  verification: { passed: true, head_sha: head, at: 't', output_tail: '', test_integrity: 'checked' },
  review: { verdict: 'approve', summary: 's', findings: [], head_sha: head, at: 't' },
  approval: { decision: 'approved', head_sha: head, at: 't' },
} as unknown as TaskRecord;

test('a signed receipt checks out; a changed, foreign or stale one does not', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-receipt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = new ReceiptKeys(root);
  const receipt = await issueReceipt(keys, task, head, []);
  assert.equal((await stat(join(keys.dir, 'private.pem'))).mode & 0o777, 0o600);
  const { publicKey } = await keys.load();
  assert.equal(checkReceipt(receipt, { currentHead: head, trustedKey: publicKey }).ok, true);

  const edited = structuredClone(receipt);
  edited.claims.find((c) => c.id === 'ci')!.status = 'proven';
  const tampered = checkReceipt(edited, { trustedKey: publicKey });
  assert.equal(tampered.ok, false);
  assert.match(tampered.lines.join('\n'), /digest: the receipt was changed/);

  const other = await mkdtemp(join(tmpdir(), 'factory-receipt-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  const foreign = await issueReceipt(new ReceiptKeys(other), task, head, []);
  assert.match(
    checkReceipt(foreign, { trustedKey: publicKey }).lines.join('\n'),
    /FAIL {2}signed by a different key/,
  );
  assert.match(
    checkReceipt(receipt, { currentHead: 'b'.repeat(40) }).lines.join('\n'),
    /FAIL {2}the head moved/,
  );
  assert.equal(
    checkReceipt(receipt, { rerun: { passed: false, detail: 'tests failed' } }).ok,
    false,
    'a failed rerun fails the check',
  );
});

test('manifests keep env names but never values, and equal calls share one entry', () => {
  const call: ModelRun = {
    step: 'coder',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    systemPrompt: 'be careful',
    prompt: 'secret task text',
    tools: 'edit',
    env: { NPM_TOKEN: 'npm_s3cr3t' },
    maxBudgetUsd: 5,
  };
  const m = callManifest(call);
  assert.deepEqual(m.env_names, ['NPM_TOKEN']);
  assert.doesNotMatch(JSON.stringify(m), /s3cr3t|secret task text|be careful/);
  assert.equal(m.system_prompt_sha256.length, 64);
  const merged = withManifest(withManifest([], m), callManifest(call));
  assert.deepEqual(
    merged.map((x) => x.calls),
    [2],
  );
  assert.equal(withManifest(merged, callManifest({ ...call, effort: 'low' })).length, 2);
});
