// The task panel's layout pieces: collapsible sections, label and value rows, and disclosures.
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@factory/ui/lib/utils';

export function Section({
  title,
  aside,
  flush,
  children,
}: {
  title: string;
  /** A short value at the right of the title, e.g. a total. */
  aside?: ReactNode;
  /** No side padding, for content that has its own (the stage timeline). */
  flush?: boolean;
  children: ReactNode;
}) {
  const id = `panel-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="py-3">
      <details open className="group/section">
        <summary className="mx-5 flex cursor-pointer list-none items-center gap-3 rounded-md py-1 select-none focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <h2 id={id} className="flex items-center gap-1 text-sm font-medium">
            {title}
            <ChevronDown
              aria-hidden
              className="size-3.5 text-muted-foreground transition-transform duration-150 ease-out -rotate-90 group-open/section:rotate-0 motion-reduce:transition-none"
            />
          </h2>
          {aside && <span className="ml-auto text-sm text-muted-foreground">{aside}</span>}
        </summary>
        <div className={cn('pt-3 pb-2', flush ? 'px-0' : 'px-5')}>{children}</div>
      </details>
    </section>
  );
}

/** Label and value rows with one label column, so every panel section lines up. */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-sm">{children}</dl>
  );
}
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** A closed-by-default section with a turning chevron. */
export function Disclosure({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn('group/disclosure', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-150 ease-out group-open/disclosure:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
