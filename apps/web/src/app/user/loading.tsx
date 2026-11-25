import { LoaderCircle } from 'lucide-react';

/** Profile and providers check the CLIs on this machine, which takes a few seconds. */
export default function Loading() {
  return (
    <p className="mx-auto flex max-w-2xl items-center gap-2 text-sm text-muted-foreground" role="status">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      Loading your settings
    </p>
  );
}
