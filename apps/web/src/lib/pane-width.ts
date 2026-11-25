// Saved widths of resizable panes, read on the server so a page renders at the saved width.
import 'server-only';
import { cookies } from 'next/headers';
import { paneCookie, type PaneSpec } from '@/lib/pane-spec';

export async function paneWidth(spec: PaneSpec): Promise<number> {
  const saved = Number((await cookies()).get(paneCookie(spec.id))?.value);
  return Number.isFinite(saved) && saved >= spec.min && saved <= spec.max ? saved : spec.default;
}
