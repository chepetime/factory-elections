'use client';
// Editable parts of an agent's page: the header actions, instructions, skills, general settings
// and environment names. Each form saves on its own button and says when it is saved.
import { Archive, ArchiveRestore, MessageSquare, Plus, Save, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition, type ReactNode } from 'react';
import { archiveAgent, startChat, updateAgent, type AgentActionState } from '@/app/agent-actions';
import { updateIssue } from '@/app/actions';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@factory/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@factory/ui/components/dialog';
import { Input } from '@factory/ui/components/input';
import { Textarea } from '@factory/ui/components/textarea';
import { EFFORTS } from '@/lib/agent-models';
import { parseModelRef } from '@factory/core';
import { AgentModelSelect, AgentProviderSelect } from './agent-model-select';
import type { AgentModelOptions } from '@/lib/agent-model-options';
import { cn } from '@factory/ui/lib/utils';

const select =
  'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

function useAgentSave(id: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<AgentActionState>({});
  const save = (patch: Record<string, unknown>, done?: () => void) =>
    start(async () => {
      const result = await updateAgent(id, patch);
      setState(result);
      if (!result.error) {
        done?.();
        router.refresh();
      }
    });
  return { pending, state, save };
}

function Notice({ state }: { state: AgentActionState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      role={state.error ? 'alert' : 'status'}
      className={cn('text-sm', state.error ? 'text-destructive' : 'text-muted-foreground')}
    >
      {state.error ?? state.message}
    </p>
  );
}

function SaveRow({ pending, dirty, state }: { pending: boolean; dirty: boolean; state: AgentActionState }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <Notice state={dirty ? {} : state} />
      {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
      <Button type="submit" disabled={pending || !dirty}>
        <Save aria-hidden /> {pending ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

/** Opens a chat with the agent in `project`, the project whose pages this is on. */
export function ChatWithAgent({
  agent,
  project,
  disabled,
}: {
  agent: string;
  project: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const result = await startChat(agent, project);
            if (result?.error) setError(result.error);
          })
        }
      >
        <MessageSquare aria-hidden /> {pending ? 'Opening…' : 'Chat'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

type TaskOption = { key: string; title: string; status: string; archived: boolean };

/** Picks a project and one of its open tasks, then assigns the task to this agent. */
export function AssignWork({
  agent,
  projects,
  disabled,
}: {
  agent: { id: string; name: string };
  projects: { name: string; label: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState(projects[0]?.name ?? '');
  const [tasks, setTasks] = useState<TaskOption[] | 'loading' | 'error'>('loading');
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = useId();
  useEffect(() => {
    if (!open || !project) return;
    let live = true;
    setTasks('loading');
    fetch(`/api/projects/${encodeURIComponent(project)}/issues`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (items: TaskOption[]) =>
          live && setTasks(items.filter((t) => !t.archived && ['backlog', 'todo'].includes(t.status))),
      )
      .catch(() => live && setTasks('error'));
    return () => {
      live = false;
    };
  }, [open, project]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={disabled || projects.length === 0} />}>
        <Plus aria-hidden /> Assign work
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(36rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] flex-col gap-0">
        <DialogHeader className="pr-8">
          <DialogTitle>Assign work to {agent.name}</DialogTitle>
          <DialogDescription>
            Pick a Backlog or Todo task. {agent.name} starts a Todo task by itself when it has a free slot; a
            Backlog task waits until you move it to Todo.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={`${id}-project`} className="mt-4 flex flex-col gap-1.5 text-sm">
          Project
          <select
            id={`${id}-project`}
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className={select}
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {tasks === 'loading' ? (
            <p className="py-4 text-sm text-muted-foreground">Loading tasks…</p>
          ) : tasks === 'error' ? (
            <p role="alert" className="py-4 text-sm text-destructive">
              Tasks unavailable. Try again.
            </p>
          ) : tasks.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No Backlog or Todo tasks in this project.</p>
          ) : (
            <ul className="flex flex-col">
              {tasks.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await updateIssue(project, t.key, { assignee: agent.id });
                        if (result.error) return setError(result.error);
                        setOpen(false);
                        router.refresh();
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.key}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InstructionsForm({ id, instructions }: { id: string; instructions: string }) {
  const [value, setValue] = useState(instructions);
  const { pending, state, save } = useAgentSave(id);
  const fieldId = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save({ instructions: value });
      }}
    >
      <label htmlFor={fieldId} className="text-sm font-medium">
        Your notes
      </label>
      <Textarea
        id={fieldId}
        rows={14}
        value={value}
        maxLength={20_000}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          'Context this agent should always have.\n\n# Example\nOur main branch is protected; open draft PRs.\nWrite tasks in English.\nWe do not deploy on Fridays.'
        }
        className="font-mono text-sm"
      />
      <SaveRow pending={pending} dirty={value !== instructions} state={state} />
    </form>
  );
}

export function SkillsForm({ id, skills, available }: { id: string; skills: string[]; available: string[] }) {
  const [picked, setPicked] = useState(skills);
  const { pending, state, save } = useAgentSave(id);
  const dirty = picked.slice().sort().join() !== skills.slice().sort().join();
  if (!available.length)
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No skills in definitions/skills yet. Add a folder with a SKILL.md to share it with agents.
      </p>
    );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save({ skills: picked });
      }}
    >
      <fieldset className="flex flex-col divide-y rounded-xl border">
        <legend className="sr-only">Skills</legend>
        {available.map((name) => (
          <label key={name} className="flex items-center gap-3 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={picked.includes(name)}
              onChange={(e) =>
                setPicked(e.target.checked ? [...picked, name] : picked.filter((s) => s !== name))
              }
              className="size-4"
            />
            <span className="font-mono text-xs">{name}</span>
          </label>
        ))}
      </fieldset>
      <SaveRow pending={pending} dirty={dirty} state={state} />
    </form>
  );
}

type General = {
  name: string;
  avatar: string;
  description: string;
  model: string;
  effort: string;
  concurrency: number;
  task_budget_usd: number;
  auto_pickup: boolean;
};

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GeneralForm({
  id,
  initial,
  models,
}: {
  id: string;
  initial: General;
  models: AgentModelOptions;
}) {
  const [value, setValue] = useState(initial);
  const [provider, setProvider] = useState(() => parseModelRef(initial.model).provider);
  const { pending, state, save } = useAgentSave(id);
  const f = useId();
  const set = <K extends keyof General>(key: K, v: General[K]) => setValue({ ...value, [key]: v });
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save(value);
      }}
    >
      <div className="divide-y">
        <Row label="Name" htmlFor={`${f}-name`}>
          <Input
            id={`${f}-name`}
            value={value.name}
            maxLength={60}
            required
            onChange={(e) => set('name', e.target.value)}
          />
        </Row>
        <Row label="Avatar" hint="One emoji." htmlFor={`${f}-avatar`}>
          <Input
            id={`${f}-avatar`}
            value={value.avatar}
            maxLength={8}
            className="w-20 text-center text-lg"
            onChange={(e) => set('avatar', e.target.value)}
          />
        </Row>
        <Row label="Description" htmlFor={`${f}-description`}>
          <Textarea
            id={`${f}-description`}
            rows={3}
            maxLength={500}
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Row>
        <Row
          label="Provider"
          htmlFor={`${f}-provider`}
          hint={provider !== 'claude' ? 'Board tasks and chats currently require Claude Code.' : undefined}
        >
          <AgentProviderSelect
            id={`${f}-provider`}
            provider={provider}
            onChange={(next) => {
              setProvider(next);
              setValue({
                ...value,
                model: models[next][0]?.id ?? '',
                auto_pickup: next === 'claude' && value.auto_pickup,
              });
            }}
          />
        </Row>
        <Row label="Model" htmlFor={`${f}-model`}>
          <AgentModelSelect
            id={`${f}-model`}
            model={value.model}
            options={models[provider]}
            onChange={(model) => set('model', model)}
          />
        </Row>
        <Row label="Effort" htmlFor={`${f}-effort`}>
          <select
            id={`${f}-effort`}
            value={value.effort}
            onChange={(e) => set('effort', e.target.value)}
            className={select}
          >
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e[0]!.toUpperCase() + e.slice(1)}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Pick up Todo tasks"
          hint="Starts Todo tasks assigned to it when it has a free slot, most urgent first."
          htmlFor={`${f}-pickup`}
        >
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              id={`${f}-pickup`}
              type="checkbox"
              className="size-4"
              checked={value.auto_pickup}
              disabled={provider !== 'claude'}
              onChange={(e) => set('auto_pickup', e.target.checked)}
            />
            {value.auto_pickup ? 'On' : 'Off: start each task yourself'}
          </label>
        </Row>
        <Row label="Concurrency" hint="Tasks it works at the same time, 1 to 5." htmlFor={`${f}-concurrency`}>
          <Input
            id={`${f}-concurrency`}
            type="number"
            min={1}
            max={5}
            className="w-24"
            value={value.concurrency}
            onChange={(e) => set('concurrency', Number(e.target.value))}
          />
        </Row>
        <Row
          label="Budget per task"
          hint="US dollars for one task's session, replies included."
          htmlFor={`${f}-budget`}
        >
          <Input
            id={`${f}-budget`}
            type="number"
            min={0.5}
            max={100}
            step={0.5}
            className="w-28"
            value={value.task_budget_usd}
            onChange={(e) => set('task_budget_usd', Number(e.target.value))}
          />
        </Row>
      </div>
      <div className="border-t pt-4">
        <SaveRow pending={pending} dirty={dirty} state={state} />
      </div>
    </form>
  );
}

export function ArchiveAgent({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<AgentActionState>({});
  const [confirm, dialog] = useConfirm();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
      {dialog}
      <div>
        <p className="text-sm font-medium">{archived ? `Restore ${name}` : `Archive ${name}`}</p>
        <p className="text-xs text-muted-foreground">
          {archived
            ? 'It can take tasks and chats again.'
            : 'It leaves the list and takes no new tasks or chats. Its history stays.'}
        </p>
        <Notice state={state} />
      </div>
      <Button
        variant="outline"
        disabled={pending}
        onClick={async () => {
          if (
            !archived &&
            !(await confirm({
              title: `Archive ${name}?`,
              body: 'Tasks assigned to it keep it as their agent, but it cannot start until you restore it.',
              confirm: 'Archive',
            }))
          )
            return;
          start(async () => {
            setState(await archiveAgent(id, !archived));
            router.refresh();
          });
        }}
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}{' '}
        {archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  );
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export function EnvironmentForm({ id, names, allowed }: { id: string; names: string[]; allowed: string[] }) {
  const [list, setList] = useState(names);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const { pending, state, save } = useAgentSave(id);
  const f = useId();
  const add = () => {
    const name = draft.trim().toUpperCase();
    if (!ENV_NAME.test(name)) return setError('Use an env var name such as LINEAR_API_KEY.');
    if (!list.includes(name)) setList([...list, name]);
    setDraft('');
    setError(undefined);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save({ pass_env: list });
      }}
    >
      <div className="flex gap-2">
        <label htmlFor={f} className="sr-only">
          Env var name
        </label>
        <Input
          id={f}
          value={draft}
          placeholder="LINEAR_API_KEY"
          className="font-mono"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          <Plus aria-hidden /> Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No env vars. Sessions get only the backend&apos;s safe defaults.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {list.map((name) => {
            const ok = allowed.includes(name);
            return (
              <li key={name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs">{name}</span>
                <span
                  className={cn(
                    'text-xs',
                    ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
                  )}
                >
                  {ok ? 'Passed' : 'Not passed: not in FACTORY_AGENT_ENV_ALLOW'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label={`Remove ${name}`}
                  onClick={() => setList(list.filter((n) => n !== name))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <SaveRow pending={pending} dirty={list.join() !== names.join()} state={state} />
    </form>
  );
}
