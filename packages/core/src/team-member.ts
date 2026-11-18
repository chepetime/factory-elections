import { z } from 'zod';

/** A person in one project, linked to their provider identities. */
export const TeamMember = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  jira_id: z.string().trim().min(1).max(200),
  github_login: z.string().trim().min(1).max(100),
});
export type TeamMember = z.infer<typeof TeamMember>;
export const TeamMemberInput = TeamMember.extend({ id: z.uuid().optional() });
