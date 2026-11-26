// Browser-tab titles. The root layout appends " · Harbor Lighthouse"; pages give the specific part,
// most specific first, so a row of tabs stays tellable apart. A leading glyph shows state at a glance.
import 'server-only';
import { cache } from 'react';
import type { Stage } from '@factory/core';
import { listProjects } from '@/lib/factory';

/** The project's display name from its settings, else its registered name. One lookup per request. */
export const projectLabel = cache(async (project: string): Promise<string> => {
  const projects = await listProjects();
  const found = projects.ok ? projects.value.find((p) => p.name === project) : undefined;
  return found?.display_name?.trim() || project;
});

/** Shorten to one line of at most `max` characters, ending in an ellipsis when cut. */
export function clip(text: string, max = 48): string {
  const line =
    text
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
      .find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What a task's stage looks like in a tab: work in progress, waiting for you, done or stuck. */
const STAGE_GLYPH: Record<Stage, string> = {
  queued: '🕒',
  classified: '🕒',
  blocked: '⛔',
  coding: '⚙️',
  'verification-failed': '❌',
  reviewing: '🔍',
  'awaiting-approval': '👀',
  approved: '✅',
  rejected: '🚫',
  'pr-opened': '🚀',
  failed: '❌',
};

export function stageGlyph(stage: Stage): string {
  return STAGE_GLYPH[stage] ?? '•';
}

const REVIEW_GLYPH: Record<string, string> = {
  preparing: '🕒',
  running: '🔍',
  completed: '✅',
  failed: '❌',
  interrupted: '⚠️',
  stopped: '⏸️',
};

export function reviewGlyph(state: string | undefined): string {
  return (state && REVIEW_GLYPH[state]) || '💬';
}

/** "Part · Project", the page-specific half of a project page's title. */
export async function projectTitle(project: string, part: string): Promise<string> {
  return `${part} · ${await projectLabel(project)}`;
}
