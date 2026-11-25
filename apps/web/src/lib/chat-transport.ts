// The chat page's AI SDK transport. A message goes to the backend through the sendChat action; the
// reply is read back from GET /api/chats/{id} and turned into UI message chunks for useChat. The
// backend owns the model call, its guard and its budget; this only moves text to the screen.
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { sendChat, stopChat } from '@/app/agent-actions';

export type ChatMeta = {
  at?: string;
  cost_usd?: number | null;
  tasks_created?: { project: string; key: string }[];
  error?: string;
};
export type FactoryMessage = UIMessage<ChatMeta>;

type Step = { name: string; detail: string; ok?: boolean };
type Turn = {
  at: string;
  role: 'user' | 'agent';
  text: string;
  cost_usd?: number | null;
  error?: string;
  tools?: Step[];
  tasks_created?: { project: string; key: string }[];
};
export type ChatSnapshot = {
  id: string;
  turns: Turn[];
  working: boolean;
  partial?: string;
  partial_tools?: Step[];
};

const POLL_MS = 400;

/** Stored turns as AI SDK messages: tool steps first, then the reply text. */
export function toMessages(turns: Turn[]): FactoryMessage[] {
  return turns.map((t, i) => ({
    id: `turn-${i}`,
    role: t.role === 'user' ? 'user' : 'assistant',
    metadata: {
      at: t.at,
      ...(t.cost_usd !== undefined ? { cost_usd: t.cost_usd } : {}),
      ...(t.tasks_created ? { tasks_created: t.tasks_created } : {}),
      ...(t.error ? { error: t.error } : {}),
    },
    parts: [
      ...(t.tools ?? []).map((s, n) => ({
        type: 'dynamic-tool' as const,
        toolName: s.name,
        toolCallId: `turn-${i}-tool-${n}`,
        input: { detail: s.detail },
        ...(s.ok === false
          ? { state: 'output-error' as const, errorText: 'Failed' }
          : { state: 'output-available' as const, output: null }),
      })),
      ...(t.text ? [{ type: 'text' as const, text: t.text }] : []),
    ],
  }));
}

async function snapshot(id: string, signal?: AbortSignal): Promise<ChatSnapshot | undefined> {
  const res = await fetch(`/api/chats/${id}`, { cache: 'no-store', ...(signal ? { signal } : {}) }).catch(
    () => undefined,
  );
  return res?.ok ? ((await res.json()) as ChatSnapshot) : undefined;
}

/**
 * Follows the reply in progress until the backend finishes it. `stored` is the number of turns
 * saved before the reply (your message included), so the stream knows which turn is its own.
 */
function follow(id: string, stored: number, signal?: AbortSignal): ReadableStream<UIMessageChunk> {
  let sentText = '';
  let textOpen = false;
  const tools: { ok?: boolean }[] = [];
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const emitTools = (steps: Step[]) => {
        steps.forEach((s, n) => {
          const toolCallId = `live-${n}`;
          if (!tools[n]) {
            tools[n] = {};
            controller.enqueue({
              type: 'tool-input-available',
              toolCallId,
              toolName: s.name,
              input: { detail: s.detail },
              dynamic: true,
            });
          }
          if (s.ok !== undefined && tools[n]!.ok === undefined) {
            tools[n]!.ok = s.ok;
            controller.enqueue(
              s.ok
                ? { type: 'tool-output-available', toolCallId, output: null, dynamic: true }
                : { type: 'tool-output-error', toolCallId, errorText: 'Failed', dynamic: true },
            );
          }
        });
      };
      const emitText = (text: string) => {
        if (!text.startsWith(sentText) || text.length === sentText.length) return;
        if (!textOpen) {
          controller.enqueue({ type: 'text-start', id: 'reply' });
          textOpen = true;
        }
        controller.enqueue({ type: 'text-delta', id: 'reply', delta: text.slice(sentText.length) });
        sentText = text;
      };
      controller.enqueue({ type: 'start' });
      for (;;) {
        if (signal?.aborted) {
          controller.enqueue({ type: 'abort', reason: 'Stopped by you.' });
          controller.close();
          return;
        }
        const chat = await snapshot(id, signal);
        if (chat) {
          const done = !chat.working && chat.turns.length > stored;
          const reply = done ? chat.turns.at(-1) : undefined;
          emitTools(reply?.tools ?? chat.partial_tools ?? []);
          emitText(reply?.text ?? chat.partial ?? '');
          if (!chat.working) {
            if (textOpen) controller.enqueue({ type: 'text-end', id: 'reply' });
            if (reply)
              controller.enqueue({
                type: 'message-metadata',
                messageMetadata: {
                  at: reply.at,
                  ...(reply.cost_usd !== undefined ? { cost_usd: reply.cost_usd } : {}),
                  ...(reply.tasks_created ? { tasks_created: reply.tasks_created } : {}),
                  ...(reply.error ? { error: reply.error } : {}),
                } satisfies ChatMeta,
              });
            controller.enqueue({ type: 'finish' });
            controller.close();
            return;
          }
        }
        await new Promise((done) => setTimeout(done, POLL_MS));
      }
    },
  });
}

export function factoryChatTransport(chatId: string): ChatTransport<FactoryMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const last = messages.at(-1);
      const text = (last?.parts ?? [])
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join('')
        .trim();
      const result = await sendChat(chatId, text);
      if (result.error) throw new Error(result.error);
      abortSignal?.addEventListener('abort', () => void stopChat(chatId), { once: true });
      // Every message before this one is a stored turn, and so is the one just sent.
      return follow(chatId, messages.length, abortSignal);
    },
    async reconnectToStream({ abortSignal }) {
      const chat = await snapshot(chatId, abortSignal);
      if (!chat?.working) return null;
      abortSignal?.addEventListener('abort', () => void stopChat(chatId), { once: true });
      return follow(chatId, chat.turns.length, abortSignal);
    },
  };
}
