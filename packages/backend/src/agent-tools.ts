// Factory tools a workspace agent calls through its MCP grant: task tools while it works a task,
// chat tools while it talks with a person. Each one changes the board through IssueService.
import { z } from 'zod';
import { IssueStatus, ProjectName } from '@factory/core';
import { toolSchema, type FactoryTool } from './delegation.ts';
import type { IssueService } from './issues.ts';

const CommentArgs = z.object({ body: z.string().trim().min(1).max(20_000).describe('Markdown') });
/** An agent reports progress; done and cancelled stay with the person. */
const AgentStatus = z.enum(['in_progress', 'in_review', 'blocked']);
const StatusArgs = z.object({ status: AgentStatus });

/** What the agent asked for during the session, read by the workflow when the session ends. */
export type SessionReport = { status?: z.infer<typeof AgentStatus> };

export function taskTools(input: {
  issues: Pick<IssueService, 'comment' | 'setStatus'>;
  project: string;
  key: string;
  agent: { id: string; name: string };
  report: SessionReport;
}): FactoryTool[] {
  const { issues, project, key, agent, report } = input;
  return [
    {
      name: 'comment',
      description: `Post a comment on task ${key} for the person. Use it for progress, findings and questions. Keep it short.`,
      inputSchema: toolSchema(CommentArgs),
      async call(raw) {
        const args = CommentArgs.safeParse(raw);
        if (!args.success) return { text: 'Give the comment a body.', isError: true };
        await issues.comment({ project, key, body: args.data.body, author: agent.id });
        return { text: `Posted on ${key}.` };
      },
    },
    {
      name: 'set_status',
      description:
        `Set task ${key}'s status: in_progress while you work, in_review when the change is ready ` +
        'for the person, blocked when you need the person. Done and cancelled are for the person.',
      inputSchema: toolSchema(StatusArgs),
      async call(raw) {
        const args = StatusArgs.safeParse(raw);
        if (!args.success) return { text: 'Use in_progress, in_review or blocked.', isError: true };
        await issues.setStatus({ project, key, status: args.data.status, by: agent.name });
        report.status = args.data.status;
        return {
          text:
            args.data.status === 'in_progress'
              ? `${key} is in progress.`
              : `${key} is ${args.data.status === 'in_review' ? 'in review' : 'blocked'}. Finish your turn now; the person replies on the task.`,
        };
      },
    },
  ];
}

const CreateArgs = z.object({
  project: ProjectName,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default('').describe('Markdown, with acceptance criteria'),
  assign_to_me: z.boolean().default(false).describe('Assign the task to you, the agent'),
});
const ListArgs = z.object({ project: ProjectName, status: IssueStatus.optional() });

export function chatTools(input: {
  issues: Pick<IssueService, 'create' | 'update' | 'list'>;
  projects: () => Promise<string[]>;
  agent: { id: string };
  onCreated: (task: { project: string; key: string }) => void;
}): FactoryTool[] {
  const { issues, projects, agent, onCreated } = input;
  const known = async (project: string) => (await projects()).includes(project);
  return [
    {
      name: 'list_tasks',
      description: 'List the board tasks of a project, optionally with one status.',
      inputSchema: toolSchema(ListArgs),
      async call(raw) {
        const args = ListArgs.safeParse(raw);
        if (!args.success) return { text: 'Name a project.', isError: true };
        if (!(await known(args.data.project)))
          return {
            text: `No project ${args.data.project}. Projects: ${(await projects()).join(', ')}`,
            isError: true,
          };
        const { items } = await issues.list(args.data.project);
        const rows = items
          .filter((i) => !i.archived_at && (!args.data.status || i.status === args.data.status))
          .map((i) => `${i.key} [${i.status}] ${i.title}`);
        return { text: rows.length ? rows.join('\n') : 'No tasks.' };
      },
    },
    {
      name: 'create_task',
      description:
        'Create a board task in Todo. It starts no work; the person moves it to In progress. ' +
        'Say what you will create before you call this.',
      inputSchema: toolSchema(CreateArgs),
      async call(raw) {
        const args = CreateArgs.safeParse(raw);
        if (!args.success) return { text: `Invalid task: ${args.error.issues[0]?.message}`, isError: true };
        const { project, title, description, assign_to_me } = args.data;
        if (!(await known(project)))
          return { text: `No project ${project}. Projects: ${(await projects()).join(', ')}`, isError: true };
        const created = await issues.create({ project, title, description, status: 'todo' });
        if (assign_to_me) await issues.update({ project, key: created.key, assignee: agent.id });
        onCreated({ project, key: created.key });
        return { text: `Created ${created.key} in ${project}.` };
      },
    },
  ];
}
