// A small Markdown subset for agent replies: headings, lists, code fences, bold, inline code and
// links, and @mentions of known agents (as chips). It builds React elements (no HTML injection),
// so model output cannot add markup or scripts.
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/** Agents a text may @mention, by id: their mention renders as a chip linking to the agent. */
/** Mentioned agents by id; `href` is their page (`/projects/<project>/agents/<id>`), when known. */
export type MentionNames = Readonly<Record<string, { name: string; avatar: string; href?: string }>>;

function inline(text: string, key: string, mentions?: MentionNames): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<=^|[\s(])@([a-z0-9][a-z0-9_-]{0,63})\b/gi;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1])
      parts.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {m[1].slice(1, -1)}
        </code>,
      );
    else if (m[2]) parts.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else if (m[5]) {
      const id = m[5].toLowerCase();
      const agent = mentions?.[id];
      // Agent pages live under a project; without one the mention is a chip, not a link.
      const chip =
        'inline-flex items-baseline gap-1 rounded-md bg-orange-500/10 px-1 font-medium text-orange-700 no-underline dark:text-orange-300';
      const face = agent && (
        <>
          <span aria-hidden className="text-[0.9em]">
            {agent.avatar}
          </span>
          {agent.name}
        </>
      );
      parts.push(
        !agent ? (
          m[0]
        ) : agent.href ? (
          <Link key={k} href={agent.href} className={`${chip} hover:bg-orange-500/20`}>
            {face}
          </Link>
        ) : (
          <span key={k} className={chip}>
            {face}
          </span>
        ),
      );
    } else
      parts.push(
        <a
          key={k}
          href={m[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {m[3]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The cells of one `| a | b |` table row. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** A pipe row followed by a `|---|---|` separator row. */
function isTableStart(lines: string[], i: number): boolean {
  return (
    /^\s*\|.*\|\s*$/.test(lines[i] ?? '') &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')
  );
}

export function Markdown({ text, mentions }: { text: string; mentions?: MentionNames }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${i}`;
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5">
          {body.join('\n')}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key} className="font-semibold">
          {inline(heading[2]!, key, mentions)}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(
          <li key={`${key}-${items.length}`}>
            {inline(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ''), `${key}-${items.length}`, mentions)}
          </li>,
        );
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        ),
      );
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th key={c} className="border-b px-2 py-1 font-semibold">
                    {inline(cell, `${key}-h${c}`, mentions)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b px-2 py-1 align-top">
                      {inline(cell, `${key}-${r}-${c}`, mentions)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !isTableStart(lines, i) &&
      !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s+)/.test(lines[i]!)
    )
      para.push(lines[i++]!);
    blocks.push(
      <p key={key}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `${key}-${j}`, mentions)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="flex flex-col gap-2 text-sm leading-6 break-words">{blocks}</div>;
}
