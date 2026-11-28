import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { RemoteTicket } from '@factory/core';
import { TicketCards } from '@/components/remote-ticket-cards';

const full: RemoteTicket[] = [
  {
    key: '#219',
    title: "Leaving an organization keeps the member's team memberships",
    state: 'OPEN',
    labels: [
      { name: 'P1', color: 'fbca04' },
      { name: 'bug', color: 'd73a4a' },
    ],
    assignees: ['ana'],
    url: 'https://github.com/acme/app/issues/219',
    updated_at: '2026-11-25T10:00:00Z',
    comments: 3,
  },
  {
    key: '#217',
    title: 'Support console',
    state: 'OPEN',
    labels: [
      { name: 'enhancement', color: 'a2eeef' },
      { name: 'P1', color: 'fbca04' },
    ],
    assignees: [],
    author: 'luis',
    url: 'https://github.com/acme/app/issues/217',
    updated_at: '2026-11-20T08:30:00Z',
    comments: 0,
  },
  {
    key: 'PROJ-12',
    title: 'Export ballots as CSV with the precinct totals and a checksum row at the end of each file',
    state: 'In Progress',
    type: 'Story',
    priority: 'High',
    labels: [{ name: 'backend' }],
    assignees: ['Mika', 'Jo'],
    updated_at: '2026-11-26T16:00:00Z',
  },
];

const meta = {
  title: 'Factory/Remote Tickets',
  component: TicketCards,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "Tickets from the project's own tracker, read from the list command's JSON output: search, label filters and a card each. Text output shows as is on the page instead.",
      },
    },
  },
  args: { tickets: full, raw: JSON.stringify(full), project: 'demo' },
} satisfies Meta<typeof TicketCards>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Cards: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('article')).toHaveLength(3);
    await userEvent.click(canvas.getByRole('button', { name: /^bug/ }));
    await expect(canvas.getAllByRole('article')).toHaveLength(1);
    await userEvent.click(canvas.getByRole('button', { name: /^bug/ }));
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search tickets' }), 'mika');
    await expect(canvas.getAllByRole('article')).toHaveLength(1);
    await expect(canvas.getByText('1 of 3 tickets')).toBeVisible();
  },
};

/** GitHub's minimal `--json number,title,labels`: cards still read, and a hint says how to get more. */
export const FewFields: Story = {
  args: {
    tickets: full.slice(0, 2).map(({ key, title, labels }) => ({ key, title, labels, assignees: [] })),
  },
};

export const NoneOpen: Story = { args: { tickets: [], raw: '[]' } };
