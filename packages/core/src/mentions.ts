// @mentions of workspace agents in ticket comments: `@devin` names the agent with id `devin`.
// Pure: the backend routes a comment by its mentions, the web app suggests and renders them.

/** `@id` at the start or after a space or `(`; ids are lowercase letters, digits, `-` and `_`. */
const MENTION = /(^|[\s(])@([a-z0-9][a-z0-9_-]{0,63})\b/gi;

/** The known agent ids a comment mentions, first mention first, each once. */
export function parseMentions(body: string, known: readonly string[]): string[] {
  const ids = new Set(known.map((k) => k.toLowerCase()));
  const found: string[] = [];
  // Code spans and blocks are text the person quotes, not a call to an agent.
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const m of text.matchAll(MENTION)) {
    const id = m[2]!.toLowerCase();
    if (ids.has(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

/**
 * The mention being typed at the caret: where its `@` is and the text after it. Undefined when
 * the caret is not right after `@` plus id characters at a word start.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([a-z0-9_-]{0,64})$/i.exec(before);
  if (!m) return undefined;
  return { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() };
}

/** `text` with the mention typed at `[start, caret)` replaced by `@id `, and the new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  id: string,
): { text: string; caret: number } {
  const after = text.slice(caret).replace(/^[a-z0-9_-]*/i, '');
  const inserted = `@${id} `;
  return {
    text: `${text.slice(0, start)}${inserted}${after.replace(/^ /, '')}`,
    caret: start + inserted.length,
  };
}
