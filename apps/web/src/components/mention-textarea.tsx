'use client';
// A textarea that suggests agents after `@`: arrows move, Enter or Tab inserts `@id `, Escape
// closes. The text stays plain (`@devin`); the backend reads the mentions from it. A highlight
// layer behind the transparent textarea, with the same box and text metrics, marks each mention of
// a known agent, so it reads as a chip while you type.
import { Fragment, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { insertMention, mentionAt } from '@factory/core';
import { Textarea, textareaBase } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface MentionAgent {
  id: string;
  name: string;
  avatar: string;
}

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  agents: readonly MentionAgent[];
};

/** The text with each `@id` of a known agent wrapped in a mark; everything else as plain text. */
export function highlightMentions(text: string, ids: ReadonlySet<string>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/(?<=^|[\s(])@([a-z0-9][a-z0-9_-]{0,63})\b/gi)) {
    if (!ids.has(m[1]!.toLowerCase())) continue;
    if (m.index > last) out.push(<Fragment key={`t${last}`}>{text.slice(last, m.index)}</Fragment>);
    out.push(
      <mark
        key={`m${m.index}`}
        data-mention={m[1]!.toLowerCase()}
        className="rounded-[4px] bg-orange-500/15 text-transparent shadow-[0_0_0_2px_rgb(249_115_22/0.15)]"
      >
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

export function MentionTextarea({ value, onValueChange, agents, onKeyDown, className, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const ids = new Set(agents.map((a) => a.id));
  const [typing, setTyping] = useState<{ start: number; query: string; caret: number }>();
  const [active, setActive] = useState(0);
  const matches = typing
    ? agents
        .filter((a) => a.id.startsWith(typing.query) || a.name.toLowerCase().startsWith(typing.query))
        .slice(0, 6)
    : [];
  const open = matches.length > 0;
  const listId = `${props.id ?? 'mention'}-agents`;

  const track = (text: string, caret: number) => {
    const m = mentionAt(text, caret);
    setTyping(m ? { ...m, caret } : undefined);
    setActive(0);
  };
  const pick = (agent: MentionAgent) => {
    if (!typing) return;
    const next = insertMention(value, typing.start, typing.caret, agent.id);
    onValueChange(next.text);
    setTyping(undefined);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && !e.metaKey && !e.ctrlKey) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[active]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTyping(undefined);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <div
        ref={backdrop}
        aria-hidden
        className={cn(
          textareaBase,
          className,
          'pointer-events-none absolute inset-0 block overflow-hidden border-transparent break-words whitespace-pre-wrap text-transparent shadow-none',
        )}
      >
        {highlightMentions(value, ids)}
        {/* A trailing newline needs a character to take its line. */}
        {'\u200b'}
      </div>
      <Textarea
        {...props}
        ref={ref}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${matches[active]!.id}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setTyping(undefined), 120)}
        onKeyDown={keys}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={cn(className, 'relative bg-transparent dark:bg-transparent')}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention an agent"
          className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-lg border bg-popover p-1 text-sm shadow-lg"
        >
          {matches.map((a, i) => (
            <li
              key={a.id}
              id={`${listId}-${a.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              <span aria-hidden>{a.avatar}</span>
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">@{a.id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
