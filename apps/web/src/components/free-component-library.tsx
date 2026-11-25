'use client';

import { useId, useState } from 'react';
import { ArrowUpRight, Check, RotateCcw, Search } from 'lucide-react';
import { CodeBlock as CleanCodeBlock } from '@factory/affect-ui/components/code-block-clean';
import { CodeBlock as ClassicCodeBlock } from '@factory/affect-ui/components/code-block';
import { DecisionInbox as CleanDecisionInbox } from '@factory/affect-ui/components/decision-inbox-clean';
import { DecisionInbox as ClassicDecisionInbox } from '@factory/affect-ui/components/decision-inbox';
import { SegmentedControl as CleanSegmentedControl } from '@factory/affect-ui/components/segmented-control-clean';
import { SegmentedControl as ClassicSegmentedControl } from '@factory/affect-ui/components/segmented-control';
import inventory from '../../../../resources/affect-ui-free-components.json';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type LibraryItem = (typeof inventory.items)[number];
type LibraryStyle = 'clean' | 'classic';
const LIVE_PREVIEWS = new Set(['code-block', 'decision-inbox', 'segmented-control']);
const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'components', label: 'Components' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'illustrations', label: 'Illustrations' },
  { value: 'motion', label: 'Motion' },
];

const SAMPLE_CODE = `import { AgentCheckpoints } from '@/components/agent-checkpoints';

export function RunHistory() {
  return (
    <AgentCheckpoints
      title="Feature implementation"
      checkpoints={checkpoints}
      head="retry"
      onRewind={(checkpoint) => restore(checkpoint.id)}
    />
  );
}`;

function importExample(item: LibraryItem, style: LibraryStyle) {
  const variant = item.variants.find((entry) => entry.style === style) ?? item.variants[0]!;
  return `import { ${variant.exports.join(', ')} } from '${variant.importPath}';`;
}

export function FreeComponentLibrary() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedSlug, setSelectedSlug] = useState('code-block');
  const [style, setStyle] = useState<LibraryStyle>('clean');
  const [resetVersion, setResetVersion] = useState(0);
  const searchId = useId();
  const query = search.trim().toLocaleLowerCase();
  const filtered = inventory.items.filter(
    (item) =>
      (category === 'all' || category === item.category) &&
      `${item.title} ${item.description}`.toLocaleLowerCase().includes(query),
  );
  const selected = filtered.find((item) => item.slug === selectedSlug) ?? filtered[0];
  const variant =
    selected && (selected.variants.find((entry) => entry.style === style) ?? selected.variants[0]!);
  const canSwitchStyle = selected?.variants.length === 2;

  return (
    <section
      id="free-library"
      aria-labelledby="free-library-heading"
      className="affect-ui-theme scroll-mt-6 space-y-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h2 id="free-library-heading" className="text-xl font-semibold tracking-tight">
            The free library
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            51 components, 2 blocks, 17 illustrations, and 4 motion effects.
          </p>
        </div>
        <a
          href={inventory.upstream}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Official MIT repository
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-col gap-4 border-b p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-0 xl:w-64">
            <label htmlFor={searchId} className="sr-only">
              Search free components
            </label>
            <Search
              className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a component…"
              className="min-h-11 pl-9 text-base"
            />
          </div>
          <CleanSegmentedControl
            aria-label="Library category"
            options={CATEGORIES.map((entry) => ({
              ...entry,
              count:
                entry.value === 'all'
                  ? inventory.items.length
                  : inventory.items.filter((item) => item.category === entry.value).length,
            }))}
            value={category}
            onChange={setCategory}
            variant="tray"
          />
        </div>
        <div className="grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="min-w-0 border-b lg:border-r lg:border-b-0">
            <p role="status" className="border-b px-5 py-3 text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? 'item' : 'items'} · choose one for its import and
              source
            </p>
            <ul
              aria-label="Free component catalog"
              className="max-h-[28rem] space-y-1 overflow-y-auto overscroll-contain p-2"
            >
              {filtered.map((item) => (
                <li key={`${item.category}/${item.slug}`}>
                  <button
                    type="button"
                    aria-pressed={item.slug === selected?.slug}
                    onClick={() => {
                      setSelectedSlug(item.slug);
                      setResetVersion((value) => value + 1);
                    }}
                    className={cn(
                      'flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-muted/70',
                      item.slug === selected?.slug && 'bg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    {LIVE_PREVIEWS.has(item.slug) && (
                      <Badge variant="outline" className="text-[10px]">
                        Live
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No matches. Try another name or category.
                </li>
              )}
            </ul>
          </div>
          <div className="min-w-0 bg-muted/20 p-5 sm:p-6">
            {selected && variant ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="font-medium">{selected.title}</h3>
                    <p className="text-xs text-muted-foreground capitalize">{selected.category}</p>
                  </div>
                  {canSwitchStyle && (
                    <CleanSegmentedControl
                      aria-label="Component style"
                      options={[
                        { value: 'clean', label: 'Clean' },
                        { value: 'classic', label: 'Classic' },
                      ]}
                      value={style}
                      onChange={setStyle}
                      variant="tray"
                    />
                  )}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{selected.description}</p>
                {LIVE_PREVIEWS.has(selected.slug) ? (
                  <>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        className="min-h-11 text-xs"
                        onClick={() => setResetVersion((value) => value + 1)}
                      >
                        <RotateCcw className="size-3.5" />
                        Reset demo
                      </Button>
                    </div>
                    <div className="min-w-0 rounded-xl border bg-background p-4">
                      <FeaturedPreview
                        key={`${selected.slug}-${style}-${resetVersion}`}
                        slug={selected.slug}
                        style={style}
                      />
                    </div>
                  </>
                ) : (
                  <p className="rounded-xl border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
                    No live preview. Open its Storybook preview below.
                  </p>
                )}
                <CleanCodeBlock code={importExample(selected, style)} language="tsx" filename="Import" wrap />
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                  <a
                    href={`http://127.0.0.1:6006/?path=/story/${selected.storybookId}--${variant.style}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Storybook preview
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </a>
                  <a
                    href={variant.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Pinned source
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </a>
                  <a
                    href={selected.reference}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Usage reference
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
                No component selected.
              </div>
            )}
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <span>affectUI by Florian Höller (adfects) · MIT license retained</span>
          <span>Source snapshot · {inventory.checkedAt}</span>
        </footer>
      </div>
    </section>
  );
}

function FeaturedPreview({ slug, style }: { slug: string; style: LibraryStyle }) {
  const [message, setMessage] = useState('');
  const [view, setView] = useState('list');
  const CodeBlock = style === 'clean' ? CleanCodeBlock : ClassicCodeBlock;
  const DecisionInbox = style === 'clean' ? CleanDecisionInbox : ClassicDecisionInbox;
  const SegmentedControl = style === 'clean' ? CleanSegmentedControl : ClassicSegmentedControl;
  if (slug === 'code-block')
    return (
      <div className="space-y-3">
        <CodeBlock
          code={SAMPLE_CODE}
          language="tsx"
          filename="run-history.tsx"
          showLineNumbers
          highlightLines={[8, 9]}
          maxHeight={260}
          onCopy={() => setMessage('Code copied.')}
        />
        <p role="status" className="min-h-4 text-xs text-muted-foreground">
          {message || 'Copy the code, or scroll inside the preview.'}
        </p>
      </div>
    );
  if (slug === 'decision-inbox')
    return (
      <div className="space-y-3">
        <DecisionInbox
          decisions={[
            {
              id: 'checks',
              title: 'Run the full verification suite?',
              detail: 'The quick checks passed. The full run takes about two minutes.',
              primary: 'Run checks',
              secondary: 'Skip for now',
            },
            {
              id: 'changes',
              title: 'Keep the proposed file changes?',
              detail: 'Three files changed in this sample run.',
              primary: 'Keep changes',
              secondary: 'Discard',
              collapsed: true,
            },
          ]}
          onDecide={(decision, answer) =>
            setMessage(
              `${decision.title} ${answer === 'primary' ? decision.primary : decision.secondary}. Demo only.`,
            )
          }
        />
        <p role="status" className="min-h-4 text-xs text-muted-foreground">
          {message || 'Sample decisions. Answers only update this preview.'}
        </p>
      </div>
    );
  return (
    <div className="space-y-5">
      <SegmentedControl
        aria-label="Task view"
        value={view}
        onChange={setView}
        variant="tray"
        options={[
          { value: 'list', label: 'List', count: 12 },
          { value: 'board', label: 'Board' },
          { value: 'timeline', label: 'Timeline' },
        ]}
      />
      <div role="status" className="flex items-center gap-2 rounded-lg bg-muted/60 px-4 py-5 text-sm">
        <Check className="size-4 text-blue-500" aria-hidden="true" />
        <span className="capitalize">{view} view selected</span>
      </div>
    </div>
  );
}
