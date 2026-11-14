import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowUpRight, Layers } from 'lucide-react';
import origins from '../../../../../resources/frontend-component-origins.json';
import { ChatComposerDemo } from '@/components/chat-composer-demo';
import { ComponentSupport } from '@/components/component-support';
import { AgentFindingsDemo } from '@/components/agent-findings-demo';
import { AgentCheckpointsDemo } from '@/components/agent-checkpoints-demo';
import { FreeComponentLibrary } from '@/components/free-component-library';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = {
  title: 'Components · Software Factory',
  description: 'An interactive gallery of components for the Software Factory.',
};

export default function ComponentsPage() {
  return (
    <main className="space-y-10 py-4 sm:py-8">
      <header className="max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          <Layers className="size-4" aria-hidden="true" />
          The workshop
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Components</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Small interfaces for work in motion. A growing collection of components for the factory, ready to
          explore.
        </p>
      </header>
      <nav aria-label="Component collections" className="flex flex-wrap gap-4 text-sm">
        <a
          href="#free-library"
          className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Free library · 74
        </a>
        <a
          href="#factory-components"
          className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Factory components · 3
        </a>
        <a
          href="#support-roadmap"
          className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Support roadmap · 26
        </a>
      </nav>
      <FreeComponentLibrary />
      <section
        id="factory-components"
        aria-label="Component gallery"
        className="grid scroll-mt-6 grid-cols-1 gap-6"
      >
        <h2 className="text-xl font-semibold tracking-tight">Factory components</h2>
        <GalleryItem
          number="01"
          id="agent-checkpoints"
          name="Agent Checkpoints"
          description="Follow a run, revisit a saved step, and branch into a new attempt. Every previous path stays in view."
        >
          <AgentCheckpointsDemo />
        </GalleryItem>
        <GalleryItem
          number="02"
          id="agent-findings"
          name="Agent Findings"
          description="Watch agents review in parallel, follow their progress, and explore findings as they arrive."
        >
          <AgentFindingsDemo />
        </GalleryItem>
        <GalleryItem
          number="03"
          id="chat-composer"
          name="Chat Composer"
          description="Compose a message with the right model, folder, and apps. Attach files, choose an approval mode, and add dictation to a draft."
        >
          <ChatComposerDemo />
        </GalleryItem>
      </section>
      <ComponentSupport />
    </main>
  );
}

function GalleryItem({
  number,
  id,
  name,
  description,
  children,
}: {
  number: string;
  id: string;
  name: keyof typeof origins;
  description: string;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-6 overflow-hidden rounded-2xl border"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground">{number}</span>
            <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">
              {name}
            </h2>
            <Badge variant="secondary">Interactive</Badge>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <a
          href={origins[name]}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          Reference
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <div className="bg-muted/35 px-3 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground sm:px-7">
        <span>shadcn/ui · Tailwind CSS · Motion</span>
        <span>Sample data · local demo</span>
      </footer>
    </article>
  );
}
