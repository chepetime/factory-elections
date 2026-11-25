'use client';
// Chats with workspace agents: the chat list, the new-chat picker, and one conversation that polls
// while the agent replies.
import { Menu } from '@base-ui/react/menu';
import { CircleCheck, CircleX, LoaderCircle, MoreHorizontal, Square } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import type { DynamicToolUIPart } from 'ai';
import { deleteChat, renameChat, startChat } from '@/app/agent-actions';
import {
  factoryChatTransport,
  toMessages,
  type ChatSnapshot,
  type FactoryMessage,
} from '@/lib/chat-transport';
import { AgentAvatar } from '@/components/agent-avatar';
import { ChatComposer } from '@/components/chat-composer';
import { useConfirm } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import { ChatScroll } from '@/components/task-chat';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ChatLine = {
  id: string;
  title: string;
  last: string;
  working: boolean;
  updated_at: string;
  agentName: string;
  avatar: ReactNode;
};

export function ChatList({ chats }: { chats: ChatLine[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex min-h-0 flex-col gap-px overflow-y-auto px-2 pb-3 max-md:max-h-48">
      {chats.map((c) => {
        const current = pathname === `/chat/${c.id}`;
        return (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                current && 'bg-muted',
              )}
            >
              {c.avatar}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                  <LocalTime
                    iso={c.updated_at}
                    format="date-time"
                    className="shrink-0 text-xs text-muted-foreground"
                  />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.agentName}
                  {c.working ? ' · replying…' : c.last ? ` · ${c.last}` : ''}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type AgentOption = { id: string; name: string; avatar: string; description: string };

export function NewChat({
  agents,
  projects,
  initialAgent,
}: {
  agents: AgentOption[];
  projects: { name: string; label: string }[];
  initialAgent?: string;
}) {
  const [agent, setAgent] = useState(agents.find((a) => a.id === initialAgent)?.id ?? agents[0]?.id);
  const [project, setProject] = useState('');
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = useId();
  if (!agents.length)
    return (
      <div className="m-auto max-w-sm p-6 text-center text-sm text-muted-foreground">
        No agents to chat with.{' '}
        <Link href="/agents" className="underline">
          Create one
        </Link>{' '}
        first.
      </div>
    );
  return (
    <div className="m-auto flex w-full max-w-xl flex-col gap-5 p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">New chat</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick an agent. A chat can read one project&apos;s repository and create tasks; it changes no code.
        </p>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Agent</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {agents.map((a) => (
            <label
              key={a.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                agent === a.id ? 'border-foreground/40 bg-muted/60' : 'hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name="agent"
                value={a.id}
                checked={agent === a.id}
                onChange={() => setAgent(a.id)}
                className="sr-only"
              />
              <AgentAvatar agent={a} decorative />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{a.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {a.description || 'No description'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${id}-project`} className="flex flex-col gap-1.5 text-sm font-medium">
        Project
        <select
          id={`${id}-project`}
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="h-9 rounded-lg border bg-background px-2.5 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">No project: the agent reads no code</option>
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        className="self-end"
        disabled={!agent || pending}
        onClick={() =>
          start(async () => {
            const result = await startChat(agent!, project || undefined);
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? 'Opening…' : 'Start chat'}
      </Button>
    </div>
  );
}

type Chat = {
  id: string;
  title: string;
  project?: string;
  turns: ChatSnapshot['turns'];
  working: boolean;
};

/** One tool step in a reply: "Read README.md", with a spinner while it runs. */
function ToolStep({ part }: { part: DynamicToolUIPart }) {
  const detail = (part.input as { detail?: string } | undefined)?.detail;
  const running = part.state === 'input-available' || part.state === 'input-streaming';
  const failed = part.state === 'output-error';
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      {running ? (
        <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" aria-label="Running" />
      ) : failed ? (
        <CircleX className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
      ) : (
        <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
      )}
      <span className="font-medium text-foreground">{part.toolName}</span>
      {detail && <span className="min-w-0 truncate font-mono">{detail}</span>}
    </li>
  );
}

function AgentReply({
  agent,
  message,
  live,
}: {
  agent: AgentOption;
  message: FactoryMessage;
  live: boolean;
}) {
  const meta = message.metadata ?? {};
  const tools = message.parts.filter((p): p is DynamicToolUIPart => p.type === 'dynamic-tool');
  const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
  return (
    <div className="flex gap-3">
      <AgentAvatar agent={agent} decorative className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{agent.name}</span>
          {meta.at && (
            <>
              {' '}
              · <LocalTime iso={meta.at} />
            </>
          )}
          {typeof meta.cost_usd === 'number' && (
            <span className="tabular-nums"> · ${meta.cost_usd.toFixed(2)}</span>
          )}
        </p>
        {tools.length > 0 && (
          <ul aria-label="Steps" className="flex flex-col gap-1 rounded-lg border bg-muted/30 px-3 py-2">
            {tools.map((part) => (
              <ToolStep key={part.toolCallId} part={part} />
            ))}
          </ul>
        )}
        {text ? (
          <div className="text-sm leading-relaxed">
            <Markdown text={text} />
          </div>
        ) : live ? (
          <p className="text-sm text-muted-foreground motion-safe:animate-pulse">{agent.name} is replying…</p>
        ) : null}
        {meta.tasks_created?.length ? (
          <ul className="flex flex-wrap gap-2">
            {meta.tasks_created.map((t) => (
              <li key={`${t.project}-${t.key}`}>
                <Link
                  href={`/projects/${t.project}/tasks/${t.key}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs hover:bg-muted"
                >
                  Created <span className="font-mono">{t.key}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {meta.error && (
          <p role="alert" className="text-sm text-destructive">
            {meta.error}
          </p>
        )}
      </div>
    </div>
  );
}

export function ChatThread({
  initial,
  agent,
  archived,
}: {
  initial: Chat;
  agent: AgentOption;
  archived: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [error, setError] = useState<string>();
  const [confirm, dialog] = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [, start] = useTransition();
  const [transport] = useState(() => factoryChatTransport(initial.id));
  const { messages, sendMessage, stop, status } = useChat<FactoryMessage>({
    id: initial.id,
    messages: toMessages(initial.turns),
    transport,
    resume: initial.working,
    onError: (e) => setError(e.message),
    // The list and the title come from the server; refresh them once a reply is saved.
    onFinish: () => router.refresh(),
  });
  const working = status === 'submitted' || status === 'streaming';
  const last = messages.at(-1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dialog}
      <header className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <AgentAvatar agent={agent} decorative />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const next = String(new FormData(e.currentTarget).get('title') ?? '').trim();
                setRenaming(false);
                if (next && next !== title)
                  start(async () => {
                    const result = await renameChat(initial.id, next);
                    if (result.error) setError(result.error);
                    else setTitle(next);
                  });
              }}
            >
              <label htmlFor="chat-title" className="sr-only">
                Chat title
              </label>
              <input
                id="chat-title"
                name="title"
                autoFocus
                defaultValue={title}
                maxLength={120}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
                className="w-full rounded-md border bg-background px-2 py-0.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </form>
          ) : (
            <h2 className="truncate text-sm font-medium">{title}</h2>
          )}
          <p className="truncate text-xs text-muted-foreground">
            <Link href={`/agents/${agent.id}`} className="hover:underline">
              {agent.name}
            </Link>
            {initial.project ? ` · reads ${initial.project}` : ' · no project'}
          </p>
        </div>
        <Menu.Root>
          <Menu.Trigger render={<Button variant="ghost" size="icon-sm" aria-label="Chat options" />}>
            <MoreHorizontal aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={6} className="z-50">
              <Menu.Popup className="min-w-40 rounded-xl border bg-popover p-1 text-sm shadow-lg outline-none">
                <Menu.Item
                  className="flex cursor-default items-center rounded-md px-2.5 py-1.5 outline-none data-highlighted:bg-muted"
                  onClick={() => setRenaming(true)}
                >
                  Rename
                </Menu.Item>
                <Menu.Item
                  disabled={working}
                  className="flex cursor-default items-center rounded-md px-2.5 py-1.5 text-destructive outline-none data-disabled:opacity-50 data-highlighted:bg-muted"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Delete this chat?',
                        body: 'It leaves your chat list. Tasks it created stay on the board.',
                        confirm: 'Delete',
                        tone: 'destructive',
                      })
                    ) {
                      const result = await deleteChat(initial.id);
                      if (result?.error) setError(result.error);
                    }
                  }}
                >
                  Delete
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </header>

      <ChatScroll>
        {messages.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-3 py-16 text-center">
            <AgentAvatar agent={agent} size="lg" decorative />
            <p className="text-base font-semibold">Chat with {agent.name}</p>
            <p className="max-w-sm text-sm text-pretty text-muted-foreground">{agent.description}</p>
          </div>
        ) : (
          messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap">
                  {message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
                </div>
                {message.metadata?.at && (
                  <p className="px-1 text-xs text-muted-foreground">
                    <LocalTime iso={message.metadata.at} />
                  </p>
                )}
              </div>
            ) : (
              <AgentReply
                key={message.id}
                agent={agent}
                message={message}
                live={working && message === last}
              />
            ),
          )
        )}
        {status === 'submitted' && last?.role === 'user' && (
          <div className="flex gap-3" role="status">
            <AgentAvatar agent={agent} decorative className="mt-0.5" />
            <p className="text-sm text-muted-foreground motion-safe:animate-pulse">
              {agent.name} is replying…
            </p>
          </div>
        )}
      </ChatScroll>

      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {working && (
            <Button variant="outline" size="sm" className="self-center" onClick={() => void stop()}>
              <Square aria-hidden /> Stop
            </Button>
          )}
          {archived && (
            <p className="text-center text-xs text-muted-foreground">
              {agent.name} is archived. Restore it to chat.
            </p>
          )}
          <ChatComposer
            placeholder={`Message ${agent.name}…`}
            onSend={async (message) => {
              setError(undefined);
              await sendMessage({ text: message });
            }}
            sending={status === 'submitted'}
            disabled={working || archived}
            {...(error ? { error } : {})}
          />
        </div>
      </div>
    </div>
  );
}
