// A fake `codex app-server` for the runner tests. FAKE_SCENARIO picks the behavior; FAKE_LOG
// receives one JSON line per event: the pid and argv, each client message, and spawned pids.
// The message shapes follow codex-cli 0.172.0 (../protocol/).
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const scenario = process.env.FAKE_SCENARIO ?? 'turn';
const log = (entry) =>
  process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(entry)}\n`);
log({ pid: process.pid, argv: process.argv.slice(2) });

const THREAD = '01a20f38-4944-73f1-a9db-3e49869c9647';
const TURN = '01a20f38-495d-7282-a298-479b85261615';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const note = (method, params) => send({ method, params, emittedAtMs: Date.now() });
const usage = (input, cached, output) => ({
  threadId: THREAD,
  turnId: TURN,
  tokenUsage: {
    total: {
      totalTokens: input + output,
      inputTokens: input,
      cachedInputTokens: cached,
      cacheWriteInputTokens: 0,
      outputTokens: output,
      reasoningOutputTokens: 0,
    },
    last: {
      totalTokens: input + output,
      inputTokens: input,
      cachedInputTokens: cached,
      cacheWriteInputTokens: 0,
      outputTokens: output,
      reasoningOutputTokens: 0,
    },
    modelContextWindow: 258400,
  },
});
const item = (method, value) => note(method, { item: value, threadId: THREAD, turnId: TURN });

/** Writes a line in small byte chunks, so frames and UTF-8 characters split across reads. */
async function sendSplit(message) {
  const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
  for (let i = 0; i < bytes.length; i += 7) {
    process.stdout.write(bytes.subarray(i, i + 7));
    await sleep(1);
  }
}

async function streamTurn() {
  const out = process.env.FAKE_SPLIT ? sendSplit : async (m) => send(m);
  await out({
    method: 'turn/started',
    params: { threadId: THREAD, turn: { id: TURN, status: 'inProgress' } },
  });
  // Noise the runner must ignore: stderr, a non-JSON line, and a server-wide notification.
  process.stderr.write('WARN skill failed to load\n');
  process.stdout.write('not json\n');
  await out({ method: 'account/rateLimits/updated', params: { rateLimits: {} } });
  await out({
    method: 'item/completed',
    params: {
      threadId: THREAD,
      turnId: TURN,
      item: { type: 'agentMessage', id: 'msg_1', text: 'Café ☕ — looking.\n', phase: 'commentary' },
    },
  });
  await out({
    method: 'item/started',
    params: {
      threadId: THREAD,
      turnId: TURN,
      item: {
        type: 'commandExecution',
        id: 'exec-1',
        command: "/bin/zsh -lc 'echo ok'",
        status: 'inProgress',
        aggregatedOutput: null,
        exitCode: null,
      },
    },
  });
  await out({
    method: 'item/completed',
    params: {
      threadId: THREAD,
      turnId: TURN,
      item: {
        type: 'commandExecution',
        id: 'exec-1',
        command: "/bin/zsh -lc 'echo ok'",
        status: 'completed',
        aggregatedOutput: 'ok\n',
        exitCode: 0,
      },
    },
  });
  await out({ method: 'thread/tokenUsage/updated', params: usage(100, 40, 7) });
  await out({
    method: 'item/agentMessage/delta',
    params: { threadId: THREAD, turnId: TURN, itemId: 'msg_2', delta: '{"ok"' },
  });
  await out({
    method: 'item/completed',
    params: {
      threadId: THREAD,
      turnId: TURN,
      item: { type: 'agentMessage', id: 'msg_2', text: '{"ok":true,"note":null}', phase: 'final_answer' },
    },
  });
  await out({
    method: 'turn/completed',
    params: { threadId: THREAD, turn: { id: TURN, status: 'completed', error: null } },
  });
}

const waiting = new Map();
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    const m = JSON.parse(line);
    log({ in: m });
    if (m.method === undefined && waiting.has(m.id)) waiting.get(m.id)(m);
    else void handle(m);
  }
});
process.stdin.on('end', () => {
  log({ stdin: 'closed' });
  if (scenario !== 'stall') process.exit(0);
});

async function handle(m) {
  switch (m.method) {
    case 'initialize':
      if (scenario === 'silent') return;
      send({
        id: m.id,
        result: {
          userAgent: 'fake/0.172.0',
          codexHome: '/nowhere',
          platformFamily: 'unix',
          platformOs: 'macos',
        },
      });
      note('remoteControl/status/changed', { status: 'disabled' });
      return;
    case 'thread/start':
      send({ id: m.id, result: { thread: { id: THREAD, turns: [] }, model: 'fake', cwd: '/nowhere' } });
      note('thread/started', { thread: { id: THREAD } });
      return;
    case 'thread/resume':
      if (scenario === 'resume-rejected')
        return send({
          id: m.id,
          error: { code: -32600, message: `no rollout found for thread id ${m.params.threadId}` },
        });
      send({ id: m.id, result: { thread: { id: m.params.threadId, turns: [] } } });
      // A resumed thread reports its earlier totals first, for an earlier turn.
      note('thread/tokenUsage/updated', { ...usage(1000, 500, 70), turnId: 'earlier-turn' });
      return;
    case 'turn/start':
      send({ id: m.id, result: { turn: { id: TURN, status: 'inProgress', items: [] } } });
      return turn();
    case 'turn/interrupt':
      if (scenario !== 'interrupt') return; // stall: never answer
      send({ id: m.id, result: {} });
      note('turn/completed', { threadId: THREAD, turn: { id: TURN, status: 'interrupted', error: null } });
      return;
  }
}

async function turn() {
  switch (scenario) {
    case 'turn':
      return streamTurn();
    case 'exit-midturn':
      process.stderr.write('panic: lost the model connection\n');
      return process.exit(3);
    case 'approval': {
      send({
        id: 'srv-1',
        method: 'item/commandExecution/requestApproval',
        params: { threadId: THREAD, turnId: TURN, itemId: 'exec-9' },
      });
      await new Promise((done) => waiting.set('srv-1', done));
      return streamTurn();
    }
    case 'interrupt': {
      item('item/started', {
        type: 'commandExecution',
        id: 'exec-2',
        command: 'sleep 30',
        status: 'inProgress',
      });
      // A command in its own group, like a PTY session: closing the server's group misses it.
      const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
      log({ descendant: child.pid });
      return;
    }
    case 'stall': {
      // Ignores SIGTERM, never answers the interrupt, and prints only diagnostics or repeats.
      process.on('SIGTERM', () => log({ sigterm: true }));
      item('item/started', {
        type: 'commandExecution',
        id: 'exec-3',
        command: 'sleep 30',
        status: 'inProgress',
      });
      note('thread/tokenUsage/updated', usage(10, 0, 1));
      setInterval(() => {
        process.stderr.write('WARN retrying telemetry\n');
        process.stdout.write('not json\n');
        note('account/rateLimits/updated', { rateLimits: {} });
        note('thread/tokenUsage/updated', usage(10, 0, 1));
      }, 20);
      return;
    }
  }
}
