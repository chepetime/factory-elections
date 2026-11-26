// The one list of backend RPCs: name -> [request message, response message] in factory.proto.
// `pnpm rpc:generate` writes the proto service block and descriptor.json from it, and protocol.ts
// derives the typed Methods from it, so an RPC is added here and nowhere else in this package.
export const RPCS = {
  GetDiagnostics: ['Empty', 'Snapshot'],
  GetTeam: ['Target', 'Snapshot'],
  ListTeamRecords: ['Target', 'Snapshot'],
  SaveTeamRecord: ['SettingsUpdate', 'Snapshot'],
  GetGitUser: ['Target', 'Text'],
  UpdateMembers: ['SettingsUpdate', 'Snapshot'],
  SaveAssignment: ['Assignment', 'Text'],
  ListProjects: ['Empty', 'Snapshot'],
  AddProject: ['ProjectRegistration', 'Snapshot'],
  ListPullRequests: ['PullRequestQuery', 'Snapshot'],
  StartReviews: ['ReviewStart', 'Snapshot'],
  GetReview: ['ReviewTarget', 'Snapshot'],
  SendReviewMessage: ['ReviewMessage', 'Text'],
  StopReview: ['ReviewTarget', 'Text'],
  RemoveReview: ['ReviewTarget', 'Text'],
  GetUserSettings: ['Empty', 'Snapshot'],
  SaveUserSettings: ['Snapshot', 'Snapshot'],
  /** Git identity, the GitHub login and each provider CLI found on this machine. */
  GetUserEnvironment: ['Empty', 'Snapshot'],
  GetProjectSettings: ['Target', 'Snapshot'],
  SaveProjectSettings: ['SettingsUpdate', 'Snapshot'],
  DetectProjectSettings: ['Target', 'Snapshot'],
  /** Facts, pruned tools and review cost; `id` is unused. */
  GetMemory: ['Target', 'Snapshot'],
  /** Drops the fact whose id is `id`. */
  ForgetFact: ['Target', 'Text'],
  /** Brings back every pruned review tool; `id` is unused. */
  RestoreTools: ['Target', 'Text'],
  /** The project's features, newest first; `id` is unused. */
  ListFeatures: ['Target', 'Snapshot'],
  /** One feature with its spec, critique and QA plan; `id` is the feature id. */
  GetFeature: ['Target', 'Snapshot'],
  /** `json`: `{ idea, title? }`. */
  CreateFeature: ['SettingsUpdate', 'Snapshot'],
  /** `json`: `{ id, action, … }`, see FeatureAction in packages/backend/src/features.ts. */
  FeatureAction: ['SettingsUpdate', 'Snapshot'],
  /** Board tasks (issues), see packages/backend/src/issues.ts. `json` carries the call's fields. */
  ListIssues: ['Target', 'Snapshot'],
  GetIssue: ['SettingsUpdate', 'Snapshot'],
  CreateIssue: ['SettingsUpdate', 'Snapshot'],
  UpdateIssue: ['SettingsUpdate', 'Snapshot'],
  MoveIssue: ['SettingsUpdate', 'Snapshot'],
  CommentIssue: ['SettingsUpdate', 'Snapshot'],
  FollowUpIssue: ['SettingsUpdate', 'Snapshot'],
  ArchiveIssue: ['SettingsUpdate', 'Snapshot'],
  DeleteIssue: ['SettingsUpdate', 'Snapshot'],
  /** Repo profile: missing, draft, approved or invalid, with its path. DraftProfile drafts a missing one. */
  GetProfileStatus: ['Target', 'Snapshot'],
  DraftProfile: ['Target', 'Snapshot'],
  ApproveProfile: ['Target', 'Snapshot'],
  /** Workspace agents. Each request is `{json}` with the agent fields or `{id}`. */
  ListAgents: ['Empty', 'Snapshot'],
  GetAgent: ['Snapshot', 'Snapshot'],
  CreateAgent: ['Snapshot', 'Snapshot'],
  UpdateAgent: ['Snapshot', 'Snapshot'],
  ArchiveAgent: ['Snapshot', 'Snapshot'],
  GetAgentStats: ['Snapshot', 'Snapshot'],
  /** A task's session log: agent messages, tool calls and results, live while a run works. */
  GetRunSession: ['Target', 'Snapshot'],
  /** Chats with agents. Send returns at once; poll GetChat for the reply (`partial` while it runs). */
  ListChats: ['Snapshot', 'Snapshot'],
  GetChat: ['Snapshot', 'Snapshot'],
  StartChat: ['Snapshot', 'Snapshot'],
  SendChatMessage: ['Snapshot', 'Snapshot'],
  StopChat: ['Snapshot', 'Snapshot'],
  RenameChat: ['Snapshot', 'Snapshot'],
  DeleteChat: ['Snapshot', 'Snapshot'],
  /** `json`: `{ task_id? , trace_id?, feature_id? }`; returns `{ spans, roots }` (trees with rolled-up cost). */
  GetTrace: ['SettingsUpdate', 'Snapshot'],
  /** `json`: `{ from?, to? }` ISO times (default: the last 7 days); empty `project`: every project. */
  GetMetrics: ['SettingsUpdate', 'Snapshot'],
  /** `json`: `{ type, days?, limit? }`; empty `project`: every project. Newest spans of one type. */
  ListSpans: ['SettingsUpdate', 'Snapshot'],
  /** Saved senior-pr-review findings; empty `project`: every project. */
  ListFindings: ['Target', 'Snapshot'],
  /** MCP servers, tools and skills the factory gives its agents; `project` scopes calls and repo skills. */
  GetSystemCatalog: ['Target', 'Snapshot'],
  ListPrReviewRecords: ['Target', 'Snapshot'],
  AddPrReviewRecord: ['SettingsUpdate', 'Snapshot'],
  ListOutcomes: ['Target', 'Snapshot'],
  AddOutcome: ['SettingsUpdate', 'Snapshot'],
  ListExperiments: ['Target', 'Snapshot'],
  AddExperiment: ['SettingsUpdate', 'Snapshot'],
  /** Everything that waits on the human, across projects: `{ items, dismissed }`. */
  GetInbox: ['Empty', 'Snapshot'],
  /** `json`: `{ id }`; `project` is unused. */
  DismissInboxItem: ['SettingsUpdate', 'Text'],
  /** Tends task `id`'s PR now (and resumes a stopped one); empty `id`: one pass over every tended PR. */
  TendPullRequests: ['Target', 'Snapshot'],
  ListTickets: ['Target', 'Snapshot'],
  ListTasks: ['Target', 'Snapshot'],
  GetTask: ['Target', 'Snapshot'],
  GetTaskControls: ['Target', 'Snapshot'],
  GetGate: ['Target', 'Snapshot'],
  GetDiff: ['Target', 'Text'],
  SubmitTask: ['Submission', 'Text'],
  ExecuteTask: ['Command', 'Text'],
  StartRun: ['Command', 'Snapshot'],
  GetBackground: ['Target', 'Snapshot'],
  ClearLog: ['Target', 'Text'],
  StopRun: ['Target', 'Text'],
  ConfirmCleanup: ['Target', 'Text'],
  StartProfileCheck: ['Target', 'Snapshot'],
  GetProfileCheck: ['Target', 'Snapshot'],
} as const satisfies Record<string, readonly [string, string]>;

export type RpcName = keyof typeof RPCS;
