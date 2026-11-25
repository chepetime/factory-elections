// Which feature commands a stage accepts, for the backend guard, the feature page and agents.
// Feature stage is durable progress; a running agent step is live ownership, not a stage.
import { z } from 'zod';
import { FeatureStage, type Feature, type Ticket } from './features.ts';

export const FeatureCommand = z.enum([
  'grill',
  'skip-grill',
  'write-spec',
  'save-spec',
  'approve-spec',
  'plan',
  'save-board',
  'approve-board',
  'mark-merged',
  'retry-ticket',
  'write-qa',
  'complete',
  'cancel',
]);
export type FeatureCommand = z.infer<typeof FeatureCommand>;

/**
 * A done or cancelled feature accepts no command, and no late agent step moves it again. The
 * backend answers a repeated `cancel` of a cancelled feature with the feature, not an error.
 */
export const FEATURE_ENDED_STAGES: readonly FeatureStage[] = ['done', 'cancelled'];
export function featureEnded(stage: FeatureStage): boolean {
  return FEATURE_ENDED_STAGES.includes(stage);
}
const OPEN_STAGES = FeatureStage.options.filter((stage) => !featureEnded(stage));

const COMMAND_STAGES: Record<FeatureCommand, readonly FeatureStage[]> = {
  grill: ['grilling'],
  'skip-grill': ['grilling'],
  'write-spec': ['grilling', 'spec'],
  'save-spec': ['spec', 'spec-approved'],
  'approve-spec': ['spec'],
  plan: ['spec-approved', 'board'],
  'save-board': ['board'],
  'approve-board': ['board'],
  'mark-merged': ['implementing'],
  'retry-ticket': ['implementing'],
  'write-qa': ['implementing', 'qa'],
  complete: ['qa'],
  cancel: OPEN_STAGES,
};

/** Whether a feature in `stage` accepts `command`, before the content and ownership checks. */
export function featureCommandAllowedIn(command: FeatureCommand, stage: FeatureStage): boolean {
  return COMMAND_STAGES[command].includes(stage);
}

/** Commands that start an agent step: they take an agent slot and run in the background. */
export const FEATURE_AGENT_COMMANDS: readonly FeatureCommand[] = ['grill', 'write-spec', 'plan', 'write-qa'];

const Blocker = z.object({
  code: z.enum(['stage', 'busy', 'answer-required', 'spec-missing', 'board-empty', 'ticket']),
  message: z.string(),
});
export type FeatureBlocker = z.infer<typeof Blocker>;

/** A failed ticket with a task can run again. */
export function ticketRetryable(ticket: Pick<Ticket, 'state' | 'task_id'>): boolean {
  return ticket.state === 'failed' && Boolean(ticket.task_id);
}
/** A ticket with several blockers waits until a person says their pull requests are merged. */
export function ticketAwaitsMerge(
  ticket: Pick<Ticket, 'blocked_by' | 'blockers_merged_at' | 'task_id'>,
): boolean {
  return ticket.blocked_by.length > 1 && !ticket.blockers_merged_at && !ticket.task_id;
}
const TICKET_COMMANDS = {
  'mark-merged': { eligible: ticketAwaitsMerge, none: 'No ticket waits for its blockers to merge.' },
  'retry-ticket': { eligible: ticketRetryable, none: 'No ticket has failed.' },
} as const;

export type FeatureFacts = Pick<Feature, 'stage' | 'grill' | 'tickets'> & {
  /** Whether spec.md has text. The feature record only says when it was written. */
  has_spec: boolean;
};

/**
 * Why the feature refuses `command` now. Empty when it accepts it. `text` is the answer sent with
 * `grill`. `busy` means an agent step runs for this feature; only `cancel` passes it.
 */
export function featureCommandBlockers(
  feature: FeatureFacts,
  command: FeatureCommand,
  context: { busy: boolean; text?: string | undefined },
): FeatureBlocker[] {
  if (context.busy && command !== 'cancel')
    return [{ code: 'busy', message: 'An agent step is running for this feature; wait for it' }];
  if (!featureCommandAllowedIn(command, feature.stage))
    return [
      {
        code: 'stage',
        message: featureEnded(feature.stage)
          ? `The feature is ${feature.stage}; it accepts no more commands`
          : `"${command}" needs the feature in ${COMMAND_STAGES[command].join(' or ')}; it is ${feature.stage}`,
      },
    ];
  if (command === 'grill' && feature.grill.turns.length && !context.text)
    return [{ code: 'answer-required', message: 'Answer the question first' }];
  if (command === 'approve-spec' && !feature.has_spec)
    return [{ code: 'spec-missing', message: 'Write the spec first' }];
  if (command === 'approve-board' && !feature.tickets.length)
    return [{ code: 'board-empty', message: 'Plan the tickets first' }];
  return [];
}

export const FeatureActionAvailability = z.object({
  action: FeatureCommand,
  allowed: z.boolean(),
  blockers: z.array(Blocker),
  /** Inputs the command needs: `text` (an answer or the spec), `tickets` (the board), `ticket` (an id). */
  requires: z.array(z.enum(['text', 'tickets', 'ticket'])),
  /** For a ticket command: the ids it accepts now. */
  tickets: z.array(z.string()).optional(),
});
export type FeatureActionAvailability = z.infer<typeof FeatureActionAvailability>;

/** Advisory snapshot only: the backend checks the feature again when a command arrives. */
export function featureActions(feature: FeatureFacts, busy: boolean): FeatureActionAvailability[] {
  return FeatureCommand.options.map((action) => {
    const requires: FeatureActionAvailability['requires'] = [];
    // An answer is an input, not a blocker: the snapshot is taken before the person writes it.
    const answer = action === 'grill' && feature.grill.turns.length > 0;
    if (answer || action === 'save-spec') requires.push('text');
    if (action === 'save-board') requires.push('tickets');
    const blockers = featureCommandBlockers(feature, action, { busy, ...(answer ? { text: '…' } : {}) });
    if (action !== 'mark-merged' && action !== 'retry-ticket')
      return { action, allowed: blockers.length === 0, blockers, requires };
    requires.push('ticket');
    const rule = TICKET_COMMANDS[action];
    const tickets = blockers.length ? [] : feature.tickets.filter(rule.eligible).map((t) => t.id);
    if (!blockers.length && !tickets.length) blockers.push({ code: 'ticket', message: rule.none });
    return { action, allowed: blockers.length === 0, blockers, requires, tickets };
  });
}
