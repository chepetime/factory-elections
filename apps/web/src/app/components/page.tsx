import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import origins from '../../../../../resources/frontend-component-origins.json';
import { ChatComposerDemo } from '@/components/chat-composer-demo';
import { ComponentSupport } from '@/components/component-support';
import { AgentFindingsDemo } from '@/components/agent-findings-demo';
import { AgentCheckpointsDemo } from '@/components/agent-checkpoints-demo';
import { FreeComponentLibrary } from '@/components/free-component-library';

export const metadata: Metadata = {
  title: 'Components',
  description: 'An interactive gallery of components for the Software Factory.',
};

export default function ComponentsPage() {
  return (
    <main className="space-y-10 py-4 sm:py-8">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Components</h1>
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
        <GalleryItem id="agent-checkpoints" name="Agent Checkpoints">
          <AgentCheckpointsDemo />
        </GalleryItem>
        <GalleryItem id="agent-findings" name="Agent Findings">
          <AgentFindingsDemo />
        </GalleryItem>
        <GalleryItem id="chat-composer" name="Chat Composer">
          <ChatComposerDemo />
        </GalleryItem>
      </section>
      <ComponentSupport />
    </main>
  );
}

function GalleryItem({
  id,
  name,
  children,
}: {
  id: string;
  name: keyof typeof origins;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-6 overflow-hidden rounded-2xl border"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
        <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">
          {name}
        </h2>
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
    </article>
  );
}
