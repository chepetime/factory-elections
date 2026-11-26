// A project's accent color: the one a person picked in project settings, or one picked from the
// project name, so each project keeps the same color without any setup.
import { z } from 'zod';

/** A `#rrggbb` color. */
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color');

/** The colors a project name picks from. Each is readable as a highlight on the dark home cards. */
export const PROJECT_ACCENTS = [
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#eab308',
  '#ef4444',
] as const;

/** The project's accent: `accent` when it is a valid color, else the name's color (FNV-1a, mixed). */
export function projectAccent(name: string, accent?: string): string {
  if (accent && HexColor.safeParse(accent).success) return accent.toLowerCase();
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Final mix (murmur3 fmix32), so names that differ only at the end still spread over the palette.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return PROJECT_ACCENTS[hash % PROJECT_ACCENTS.length]!;
}
