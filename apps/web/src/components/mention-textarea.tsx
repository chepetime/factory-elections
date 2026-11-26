'use client';
// A textarea that suggests agents after `@`: arrows move, Enter or Tab inserts `@id `, Escape
// closes. The text stays plain (`@devin`); the backend reads the mentions from it.
import { useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { insertMention, mentionAt } from '@factory/core';
import { Textarea } from '@/components/ui/textarea';
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

export function MentionTextarea({ value, onValueChange, agents, onKeyDown, className, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
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
        className={className}
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
