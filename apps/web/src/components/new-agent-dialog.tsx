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
import { AGENT_MODELS } from '@/lib/agent-models';

const field = 'flex flex-col gap-1.5 text-sm';
const select =
  'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** `base`: the agents list the new agent's page opens under. */
export function NewAgentButton({ base }: { base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = useId();
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
                model: String(form.get('model') ?? ''),
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
          <label className={field} htmlFor={`${id}-model`}>
            Model
            <select id={`${id}-model`} name="model" defaultValue={AGENT_MODELS[0].id} className={select}>
              {AGENT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}: {m.hint}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
