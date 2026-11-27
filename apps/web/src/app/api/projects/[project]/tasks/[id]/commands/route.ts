// POST /api/projects/{project}/tasks/{id}/commands: the slow task commands (approve, open the pull
// request, reject) as a plain request. Next.js holds every navigation while a server action is
// pending, so a form that awaited a push to GitHub froze the app; a fetch to this route does not.
// It runs the same functions as the server actions, so their checks and revalidation are shared.
// The proxy (src/proxy.ts) accepts the POST only from this app's own pages.
import {
  approveAndOpenPullRequest,
  approveTask,
  openPullRequest,
  rejectTask,
  type ActionState,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

const COMMANDS = {
  approve: approveTask,
  'approve-open-pr': approveAndOpenPullRequest,
  'open-pr': openPullRequest,
  reject: rejectTask,
} satisfies Record<string, (prev: ActionState, form: FormData) => Promise<ActionState>>;

export type TaskCommand = keyof typeof COMMANDS;

export async function POST(request: Request, ctx: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await ctx.params;
  const form = await request.formData();
  const name = String(form.get('command') ?? '');
  if (!Object.hasOwn(COMMANDS, name)) return Response.json({ error: 'Unknown command.' }, { status: 400 });
  // The path names the task; the form's own fields cannot point the command elsewhere.
  form.set('project', project);
  form.set('id', id);
  const state = await COMMANDS[name as TaskCommand]({}, form);
  return Response.json(state, { status: state.error ? 422 : 200 });
}
