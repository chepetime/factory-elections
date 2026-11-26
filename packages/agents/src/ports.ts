// What agents need from the task board. The backend passes its IssueService; tests pass fakes.
import type { DropAction, IssueList, IssueStatus, IssueView } from '@factory/core';

type TaskKey = { project: string; key: string };

export interface AgentBoard {
  list(project: string): Promise<IssueList>;
  get(input: TaskKey): Promise<IssueView>;
  create(input: {
    project: string;
    title: string;
    description?: string;
    status?: 'backlog' | 'todo';
    /** The agent that creates it. */
    created_by?: string;
  }): Promise<IssueView>;
  /** `assignee`: an agent id, or null to unassign. */
  update(
    input: TaskKey & { title?: string; description?: string; assignee?: string | null },
  ): Promise<IssueView>;
  /** `author`: the agent id; people comment as `you`. */
  comment(input: TaskKey & { body: string; parent?: string; author?: string }): Promise<IssueView>;
  note(input: TaskKey & { kind: string; message: string }): Promise<IssueView>;
  /** `by`: who set it, for the activity feed. */
  setStatus(input: TaskKey & { status: IssueStatus; by: string }): Promise<IssueView>;
  move(input: TaskKey & { to: IssueStatus }): Promise<{ action: DropAction['kind']; issue: IssueView }>;
}
