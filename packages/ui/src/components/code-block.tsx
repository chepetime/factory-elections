'use client';
// Code on a faint panel: a header with the file name (or language) and a copy button, optional line
// numbers that stay put while long lines scroll sideways, marked lines, wrapping, and a max height
// after which the code scrolls inside. A small built-in colorizer covers TypeScript/JavaScript, JSON,
// Bash and Python; `diff` colors added and deleted lines; anything else is plain text.
// Adapted from affectUI's Code Block (Clean), MIT, © 2026 Florian Höller
// (https://github.com/flohoeller/affectui at 46721aa); restyled with this package's theme tokens.
import { Check, Copy } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { cn } from '../lib/utils';

export type CodeBlockProps = {
  /** The code, copied exactly as given. */
  code: string;
  /** ts, tsx, js, json, bash, sh, python, diff…: colors the code when known, otherwise plain text. */
  language?: string;
  /** Shown in the header, e.g. "agent.config.ts". Without it the header names the language. */
  filename?: string;
  /** Numbers in front of every line; they stay in place while the code scrolls sideways. */
  showLineNumbers?: boolean;
  /** Lines to mark, counted from 1. */
  highlightLines?: number[];
  /** Long lines wrap instead of scrolling sideways. */
  wrap?: boolean;
  /** After this height the code scrolls inside, e.g. 320 or "40vh". */
  maxHeight?: number | string;
  /** The copy button in the header. */
  copyable?: boolean;
  /** Called after the code was copied, e.g. for a toast. */
  onCopy?: (code: string) => void;
  /** `destructive`: the output of a failed step, with a red edge and label. */
  tone?: 'default' | 'destructive';
} & Omit<ComponentProps<'figure'>, 'children'>;

type Kind = 'com' | 'str' | 'kw' | 'num' | 'lit' | 'fn' | 'key' | 'var';
type Token = [Kind | null, string];

const TOKEN: Record<Kind, string> = {
  com: 'text-code-comment',
  str: 'text-code-string',
  kw: 'text-code-keyword',
  num: 'text-code-number',
  lit: 'text-code-number',
  fn: 'text-code-function',
  key: 'text-foreground',
  var: 'text-code-function',
};

function CodeBlock({
  code,
  language,
  filename,
  showLineNumbers = false,
  highlightLines,
  wrap = false,
  maxHeight,
  copyable = true,
  onCopy,
  tone = 'default',
  className,
  style,
  ...props
}: CodeBlockProps) {
  // One trailing newline is how files end; it should not show as an empty last line.
  const source = typeof code === 'string' ? code : String(code ?? '');
  const shown = source.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const lang = resolve(language);
  const lines = useMemo(() => toLines(tokenize(shown, lang)), [shown, lang]);
  const diff = lang === 'diff' ? shown.split('\n').map(diffKind) : undefined;
  const marked = useMemo(() => new Set(highlightLines ?? []), [highlightLines]);
  const label = filename || languageName(language);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const [copied, setCopied] = useState(false);

  // A scrolling block is reachable by Tab, so keyboard users can scroll it with the arrow keys.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () =>
      setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [shown, wrap, maxHeight, showLineNumbers]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = () =>
    copyText(source).then((ok) => {
      if (!ok) return;
      setCopied(true);
      onCopy?.(source);
    });

  const digits = String(lines.length).length;

  return (
    <figure
      data-slot="code-block"
      data-tone={tone}
      className={cn(
        'relative m-0 flex min-w-0 flex-col overflow-hidden rounded-lg border bg-code text-[13px] leading-5 text-foreground',
        tone === 'destructive' &&
          'border-destructive/45 bg-[color-mix(in_oklab,var(--destructive)_4%,var(--card))] shadow-[inset_3px_0_0_var(--destructive)]',
        className,
      )}
      style={{ ...style, ['--code-digits' as string]: digits }}
      {...props}
    >
      {(label || copyable) && (
        <figcaption className="flex h-9 flex-none items-center gap-2 border-b pr-1.5 pl-3.5">
          <span
            dir="auto"
            title={label || undefined}
            className={cn(
              'min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground',
              tone === 'destructive' && 'text-destructive',
            )}
          >
            {label}
          </span>
          {copyable && (
            <button
              type="button"
              data-copied={copied || undefined}
              aria-label={copied ? 'Copied' : 'Copy code'}
              title={copied ? 'Copied' : 'Copy code'}
              onClick={copy}
              className="grid size-6 flex-none place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-copied:text-foreground [&_svg]:size-3.5"
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </button>
          )}
        </figcaption>
      )}
      {/* Screen readers hear the copy; the button's new name alone is not announced. */}
      {copyable && (
        <span className="sr-only" role="status">
          {copied ? 'Copied' : ''}
        </span>
      )}
      <div
        ref={scroller}
        style={maxHeight != null ? { maxHeight } : undefined}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? `${label || 'Code'}, code` : undefined}
        className="relative min-h-0 min-w-0 flex-auto overflow-auto overscroll-x-contain outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <pre dir="ltr" className="m-0 py-2.5 font-mono text-xs leading-5 [tab-size:2]">
          <code className={cn('block font-[inherit]', wrap ? 'w-auto' : 'w-max min-w-full')}>
            {lines.map((line, i) => {
              const mark = marked.has(i + 1);
              const change = diff?.[i];
              return (
                <span
                  key={i}
                  data-slot="code-line"
                  data-marked={mark || undefined}
                  data-diff={change}
                  className={cn(
                    'flex min-h-5',
                    showLineNumbers ? 'pr-3.5' : 'px-3.5',
                    mark && 'bg-code-mark shadow-[inset_2px_0_0_var(--code-mark-edge)]',
                    change === 'add' && 'bg-diff-add-bg text-diff-add',
                    change === 'del' && 'bg-diff-del-bg text-diff-del',
                  )}
                >
                  {showLineNumbers && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'sticky left-0 z-1 min-w-[calc(var(--code-digits)*1ch+30px)] flex-none bg-code pr-3.5 pl-4 text-right text-muted-foreground tabular-nums select-none',
                        tone === 'destructive' && 'bg-transparent',
                        mark && 'text-foreground/70',
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span
                    className={cn(
                      wrap
                        ? 'min-w-0 flex-auto [overflow-wrap:anywhere] whitespace-pre-wrap'
                        : 'flex-[1_0_auto] whitespace-pre',
                    )}
                  >
                    {line.map(([kind, text], j) =>
                      kind && !change ? (
                        <span key={j} className={TOKEN[kind]}>
                          {text}
                        </span>
                      ) : (
                        text
                      ),
                    )}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </figure>
  );
}

/** A unified diff line: added, deleted, or neither (context, headers, hunks). */
function diffKind(line: string): 'add' | 'del' | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'del';
  return undefined;
}

/* ---------- The colorizer ---------- */

type Lang = 'js' | 'json' | 'bash' | 'python' | 'diff';

const ALIASES: Record<string, Lang> = {
  ts: 'js',
  tsx: 'js',
  typescript: 'js',
  js: 'js',
  jsx: 'js',
  javascript: 'js',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  jsonc: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  python: 'python',
  py: 'python',
  diff: 'diff',
  patch: 'diff',
};

const NAMES: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Zsh',
  console: 'Terminal',
  python: 'Python',
  py: 'Python',
  diff: 'Diff',
  patch: 'Diff',
};

const resolve = (language?: string): Lang | null =>
  language ? (ALIASES[language.toLowerCase()] ?? null) : null;
const languageName = (language?: string) => (language ? (NAMES[language.toLowerCase()] ?? language) : '');

const END = '(?![\\s\\S])';
const BLOCK_COMMENT = `\\/\\*[\\s\\S]*?(?:\\*\\/|${END})`;

/** Each language: [kind, pattern] in order; at one spot the first that matches wins. */
const RULES: Record<Exclude<Lang, 'diff'>, [Kind, string][]> = {
  js: [
    ['com', `\\/\\/[^\\n]*|${BLOCK_COMMENT}`],
    ['str', `"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\[\\s\\S])*\`?`],
    ['num', `\\b0[xXbBoO][\\da-fA-F_]+n?\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?\\b`],
    ['lit', `\\b(?:true|false|null|undefined|NaN|Infinity)\\b`],
    [
      'kw',
      `\\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|keyof|let|new|of|private|protected|public|readonly|return|satisfies|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\\b`,
    ],
    ['fn', `(?<![\\w$])[A-Za-z_$][\\w$]*(?=\\s*\\()`],
  ],
  json: [
    ['com', `\\/\\/[^\\n]*|${BLOCK_COMMENT}`],
    ['key', `"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)`],
    ['str', `"(?:[^"\\\\\\n]|\\\\.)*"?`],
    ['num', `-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b`],
    ['lit', `\\b(?:true|false|null)\\b`],
  ],
  bash: [
    ['com', `(?<![^\\s;|&(])#[^\\n]*`],
    ['str', `"(?:[^"\\\\]|\\\\[\\s\\S])*"?|'[^']*'?`],
    ['var', `\\$\\{[^}\\n]*\\}?|\\$[A-Za-z_]\\w*|\\$[0-9@#?*$!-]`],
    [
      'kw',
      `\\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|export|local|readonly|unset|exit)\\b`,
    ],
    // The command: the first word of a line or after a pipe, ;, && or $(, but not NAME=value.
    ['fn', `(?<=^[ \\t]*|[|;&(][ \\t]*)[A-Za-z_.\\/~][\\w.\\/~+-]*(?![\\w=])`],
  ],
  python: [
    ['com', `#[^\\n]*`],
    [
      'str',
      `(?:\\b[rRbBuUfF]{1,2})?(?:"""[\\s\\S]*?(?:"""|${END})|'''[\\s\\S]*?(?:'''|${END})|"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?)`,
    ],
    ['fn', `@[A-Za-z_][\\w.]*`],
    ['num', `\\b0[xXoObB][\\da-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?j?\\b`],
    ['lit', `\\b(?:True|False|None|self|cls)\\b`],
    [
      'kw',
      `\\b(?:and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield)\\b`,
    ],
    ['fn', `\\b[A-Za-z_]\\w*(?=\\s*\\()`],
  ],
};

const compiled = new Map<Lang, { re: RegExp; kinds: Kind[] }>();
function grammar(lang: Exclude<Lang, 'diff'>) {
  let g = compiled.get(lang);
  if (!g) {
    const rules = RULES[lang];
    g = { re: new RegExp(rules.map(([, p]) => `(${p})`).join('|'), 'gm'), kinds: rules.map(([k]) => k) };
    compiled.set(lang, g);
  }
  return g;
}

function tokenize(text: string, lang: Lang | null): Token[] {
  // Diff lines are colored whole, by their first character.
  if (!lang || lang === 'diff' || !text) return [[null, text]];
  const { re, kinds } = grammar(lang);
  re.lastIndex = 0;
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push([null, text.slice(last, m.index)]);
    const group = m.findIndex((g, i) => i > 0 && g !== undefined);
    out.push([kinds[group - 1] ?? null, m[0]]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push([null, text.slice(last)]);
  return out;
}

/** Splits the tokens into lines; a comment or string over several lines keeps its color on each. */
function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const [kind, text] of tokens) {
    text.split('\n').forEach((part, i) => {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1]!.push([kind, part]);
    });
  }
  return lines;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and insecure contexts.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export { CodeBlock };
