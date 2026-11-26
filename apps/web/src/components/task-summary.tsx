// The summary under a ticket's title: status, priority, agent, creator, dates and feature.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { issueCreator } from '@factory/core';
import {
  IssueAssigneeField,
  IssueDateField,
  IssuePriorityField,
  IssueStatusField,
} from '@/components/issue-editor';
import { type IssueView } from '@/lib/issues';
import { AgentAvatar } from '@/components/agent-avatar';

type SummaryAgent = { id: string; name: string; avatar: string; archived: boolean };

/** One labeled value in the summary row under the title. */
function SummaryItem({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex min-h-7 items-center text-sm">{children}</div>
    </div>
  );
}

function Creator({ creator, agents }: { creator?: string; agents: SummaryAgent[] }) {
  if (!creator) return <span className="text-muted-foreground">Not recorded</span>;
  if (creator === 'you') return <span>You</span>;
  if (creator === 'factory') return <span>Factory</span>;
  const agent = agents.find((a) => a.id === creator);
  if (!agent) return <span>{creator}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <AgentAvatar agent={agent} size="sm" decorative />
      {agent.name}
    </span>
  );
}

/** What the task is and who has it: status, priority, agent, creator, and its planning dates. */
export function TaskSummary({
  project,
  issue,
  agents,
  feature,
}: {
  project: string;
  issue: IssueView;
  agents: SummaryAgent[];
  feature?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!issue.due_date && issue.due_date < today && issue.status !== 'done';
  return (
    <div
      aria-label="Summary"
      role="group"
      className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-xs sm:grid-cols-4"
    >
      <SummaryItem label="Status">
        <IssueStatusField
          project={project}
          issue={{ key: issue.key, title: issue.title, status: issue.status, run: issue.run }}
        />
      </SummaryItem>
      <SummaryItem label="Priority" htmlFor="issue-priority">
        <IssuePriorityField
          project={project}
          issueKey={issue.key}
          priority={issue.priority}
          id="issue-priority"
          className="mx-0 -ml-1.5"
        />
      </SummaryItem>
      <SummaryItem label="Agent" htmlFor="issue-assignee">
        <IssueAssigneeField
          project={project}
          issueKey={issue.key}
          {...(issue.assignee ? { assignee: issue.assignee } : {})}
          agents={agents}
          id="issue-assignee"
          className="mx-0 -ml-1.5"
        />
      </SummaryItem>
      <SummaryItem label="Created by">
        <Creator creator={issueCreator(issue)} agents={agents} />
      </SummaryItem>
      <SummaryItem label="Start date" htmlFor="issue-start-date">
        <IssueDateField
          project={project}
          issueKey={issue.key}
          field="start_date"
          id="issue-start-date"
          {...(issue.start_date ? { value: issue.start_date } : {})}
        />
      </SummaryItem>
      <SummaryItem label={overdue ? 'Due date (late)' : 'Due date'} htmlFor="issue-due-date">
        <IssueDateField
          project={project}
          issueKey={issue.key}
          field="due_date"
          id="issue-due-date"
          overdue={overdue}
          {...(issue.due_date ? { value: issue.due_date } : {})}
        />
      </SummaryItem>
      <SummaryItem label="Feature">
        {feature ? (
          <Link
            href={`/projects/${project}/features/${encodeURIComponent(feature)}`}
            className="truncate underline-offset-2 hover:underline"
          >
            {feature}
          </Link>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </SummaryItem>
      {issue.jira_key && (
        <SummaryItem label="Jira">
          <span className="font-mono text-xs">{issue.jira_key}</span>
        </SummaryItem>
      )}
    </div>
  );
}
