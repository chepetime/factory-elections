import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessageChunk } from 'ai';
import { sendChat } from '@/app/agent-actions';
import { factoryChatTransport, toMessages, type ChatSnapshot } from '@/lib/chat-transport';

vi.mock('@/app/agent-actions', () => ({
  sendChat: vi.fn(async () => ({})),
  stopChat: vi.fn(async () => ({})),
}));

const user = { at: '2026-11-25T00:00:00.000Z', role: 'user' as const, text: 'Plan the work' };
function serve(snapshots: Partial<ChatSnapshot>[]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = snapshots[Math.min(i++, snapshots.length - 1)]!;
      return new Response(JSON.stringify({ id: 'c', turns: [user], working: true, ...next }), {
        status: 200,
      });
    }),
  );
}
async function read(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('chat transport', () => {
  it('sends the message, then streams text deltas, tool steps and the saved reply', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    serve([
      { partial: 'Look' },
      { partial: 'Looking at', partial_tools: [{ name: 'Read', detail: 'README.md' }] },
      {
        working: false,
        turns: [
          user,
          {
            at: '2026-11-25T00:00:05.000Z',
            role: 'agent',
            text: 'Looking at the README.',
            cost_usd: 0.02,
            tools: [{ name: 'Read', detail: 'README.md', ok: true }],
          },
        ],
      },
    ]);
    const stream = await factoryChatTransport('c').sendMessages({
      trigger: 'submit-message',
      chatId: 'c',
      messageId: undefined,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Plan the work' }] }],
      abortSignal: undefined,
    });
    expect(sendChat).toHaveBeenCalledWith('c', 'Plan the work');
    const chunks = await read(stream);
    const deltas = chunks.flatMap((c) => (c.type === 'text-delta' ? [c.delta] : []));
    expect(deltas.join('')).toBe('Looking at the README.');
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'tool-input-available',
      'text-delta',
      'tool-output-available',
      'text-delta',
      'text-end',
      'message-metadata',
      'finish',
    ]);
    expect(chunks.find((c) => c.type === 'message-metadata')).toMatchObject({
      messageMetadata: { cost_usd: 0.02 },
    });
  });

  it('resumes only a reply in progress, and refuses a send the backend refuses', async () => {
    serve([{ working: false }]);
    expect(await factoryChatTransport('c').reconnectToStream({ chatId: 'c' })).toBeNull();
    vi.mocked(sendChat).mockResolvedValueOnce({ error: 'Every agent slot is in use.' });
    await expect(
      factoryChatTransport('c').sendMessages({
        trigger: 'submit-message',
        chatId: 'c',
        messageId: undefined,
        messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        abortSignal: undefined,
      }),
    ).rejects.toThrow('Every agent slot is in use.');
  });

  it('turns saved turns into messages with tool steps before the text', () => {
    const [, reply] = toMessages([
      user,
      { at: user.at, role: 'agent', text: 'Done', tools: [{ name: 'Search', detail: 'TODO', ok: false }] },
    ]);
    expect(reply!.role).toBe('assistant');
    expect(reply!.parts.map((p) => p.type)).toEqual(['dynamic-tool', 'text']);
    expect(reply!.parts[0]).toMatchObject({ state: 'output-error', toolName: 'Search' });
  });
});
