import 'server-only';
import { backendCall } from '@factory/backend/client';
import { z } from 'zod';
const Item = z.object({
  id: z.string(),
  kind: z.string(),
  project: z.string(),
  title: z.string(),
  action: z.string(),
  since: z.string(),
  task_id: z.string().optional(),
  feature_id: z.string().optional(),
  ticket: z.string().optional(),
  pr: z.object({ number: z.number(), url: z.string().optional() }).optional(),
  detail: z.string().optional(),
  /** The board task that owns the item's run, filled in by the web app (see withTaskKeys). */
  task_key: z.string().optional(),
});
export type InboxItem = z.infer<typeof Item>;
const Inbox = z.object({ items: z.array(Item), dismissed: z.number() });
export async function getInbox() {
  try {
    return { ok: true as const, value: Inbox.parse(JSON.parse((await backendCall('GetInbox', {})).json)) };
  } catch {
    return { ok: false as const };
  }
}
