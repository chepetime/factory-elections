'use client';
// "New agent": name, avatar, description and model. Everything else has a default and is edited later.
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { createAgent } from '@/app/agent-actions';
import { Button } from '@factory/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@factory/ui/components/dialog';
import { Input } from '@factory/ui/components/input';
import { Textarea } from '@factory/ui/components/textarea';
import { type UserProvider } from '@factory/core';
import { AgentModelSelect, AgentProviderSelect } from './agent-model-select';
import type { AgentModelOptions } from '@/lib/agent-model-options';

const field = 'flex flex-col gap-1.5 text-sm';

/** `base`: the agents list the new agent's page opens under. */
export function NewAgentButton({ base, models }: { base: string; models: AgentModelOptions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = useId();
  const [provider, setProvider] = useState<UserProvider>('claude');
  const [model, setModel] = useState(models.claude[0]?.id ?? '');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus aria-hidden /> New agent
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="pr-8">
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Instructions, skills and limits can be set after you create it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            start(async () => {
              const result = await createAgent({
                name: String(form.get('name') ?? ''),
                avatar: String(form.get('avatar') ?? '').trim() || undefined,
                description: String(form.get('description') ?? ''),
                model,
                auto_pickup: provider === 'claude',
              });
              if (result.error) return setError(result.error);
              setOpen(false);
              router.push(`${base}/${result.id}`);
            });
          }}
        >
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <label className={field} htmlFor={`${id}-avatar`}>
              Avatar
              <Input
                id={`${id}-avatar`}
                name="avatar"
                defaultValue="🤖"
                maxLength={8}
                className="text-center text-lg"
              />
            </label>
            <label className={field} htmlFor={`${id}-name`}>
              Name
              <Input id={`${id}-name`} name="name" required maxLength={60} placeholder="Ada" autoFocus />
            </label>
          </div>
          <label className={field} htmlFor={`${id}-description`}>
            What it does
            <Textarea
              id={`${id}-description`}
              name="description"
              rows={2}
              maxLength={500}
              placeholder="Reviews accessibility in our web app and fixes what it finds."
            />
          </label>
          <div className={field}>
            <label htmlFor={`${id}-provider`}>Provider</label>
            <AgentProviderSelect
              id={`${id}-provider`}
              provider={provider}
              onChange={(next) => {
                setProvider(next);
                setModel(models[next][0]?.id ?? '');
              }}
            />
          </div>
          <div className={field}>
            <label htmlFor={`${id}-model`}>Model</label>
            <AgentModelSelect
              id={`${id}-model`}
              model={model}
              options={models[provider]}
              onChange={setModel}
            />
          </div>
          {provider !== 'claude' && (
            <p className="text-xs text-muted-foreground">
              Board tasks and chats currently require Claude Code.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending || !model}>
              {pending ? 'Creating…' : 'Create agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
