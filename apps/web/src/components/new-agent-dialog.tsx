'use client';
// "New agent": name, avatar, description and model. Everything else has a default and is edited later.
import { Dialog } from '@base-ui/react/dialog';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { createAgent } from '@/app/agent-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button size="sm" />}>
        <Plus aria-hidden /> New agent
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 motion-safe:transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-5 shadow-2xl outline-none motion-safe:transition-[opacity,scale] data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">New agent</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Instructions, skills and limits can be set after you create it.
              </Dialog.Description>
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <X aria-hidden />
            </Dialog.Close>
          </div>
          <form
            className="mt-5 flex flex-col gap-4"
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
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button type="button" variant="outline" />}>Cancel</Dialog.Close>
              <Button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create agent'}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
