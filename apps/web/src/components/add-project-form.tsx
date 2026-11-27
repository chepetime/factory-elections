'use client';
// Registers a local repository as a project. The name follows the folder name until you edit it.
import { useActionState, useId, useState } from 'react';
import { addProject, type ActionState } from '@/app/actions';
import { Button } from '@factory/ui/components/button';
import { Input } from '@factory/ui/components/input';
import { Label } from '@factory/ui/components/label';

/** A valid project name from the last path segment, e.g. `/code/My App` → `My-App`. */
export function suggestName(repo: string): string {
  const folder = repo.split('/').filter(Boolean).at(-1) ?? '';
  return folder.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function AddProjectForm({
  action = addProject,
}: {
  action?: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [repo, setRepo] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const repoId = useId();
  const nameId = useId();
  const hintId = useId();
  const shownName = nameEdited ? name : suggestName(repo);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={repoId}>Repository path</Label>
        <Input
          id={repoId}
          name="repo"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="/Users/you/code/my-app"
          className="font-mono"
          aria-describedby={hintId}
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          The absolute path of a local Git checkout with a GitHub <code>origin</code>.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>Project name</Label>
        <Input
          id={nameId}
          name="name"
          required
          autoComplete="off"
          spellCheck={false}
          pattern="[A-Za-z0-9_\-]+"
          title="Letters, numbers, hyphens and underscores"
          placeholder="my-app"
          value={shownName}
          onChange={(e) => {
            setNameEdited(true);
            setName(e.target.value);
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add project'}
        </Button>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
