import { LoaderCircle } from 'lucide-react';

/** Reading the CLIs on this machine takes a few seconds. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">User settings</h1>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Checking Claude Code, Codex and Pi on this machine
      </p>
    </div>
  );
}
