import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { TaskRecord } from '@factory/core';
import { Board } from '@/components/board';
import { buildBoard, type BoardInput } from '@/lib/board';

// Fictional fixtures. Ages count from NOW.
const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
let n = 0;
function task(prompt: string, over: Partial<TaskRecord> = {}): TaskRecord {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    project: 'shop',
    repo: '/repos/shop',
    prompt,
    stage: 'coding',
    created_at: min(300),
    updated_at: min(60),
    ...over,
  } as TaskRecord;
}
const worktree = (branch: string) => ({ path: `/w/${branch}`, branch, base_branch: 'main' });
const pr = (branch: string, number: number, at: number) => ({
  url: `https://github.com/example/shop/pull/${number}`,
  branch,
  head_sha: 'abc123',
  at: min(at),
});

const coding = task('Add a saved-cart banner to the checkout page', {
  worktree: worktree('factory/saved-cart'),
  events: [{ at: min(3), kind: 'stage:coding', message: 'Coding started' }],
});
const failing = task('Fix the flaky price rounding test', {
  stage: 'failed',
  worktree: worktree('factory/price-rounding'),
});
const blocked = task('Make search faster', {
  stage: 'blocked',
  updated_at: min(25),
  verdict: { blockers: [{ question: 'Which search: the product list or the admin search?' }] },
} as Partial<TaskRecord>);
const gate = task('Show the delivery estimate on the product page', {
  stage: 'awaiting-approval',
  worktree: worktree('factory/delivery-estimate'),
  events: [
    { at: min(12), kind: 'stage:awaiting-approval', message: 'Review approved; waiting for your decision' },
  ],
});
const prReview = task('Rename the order status enum', {
  stage: 'pr-opened',
  pr: pr('factory/order-status', 412, 90),
});
const prReady = task('Remove the old coupon endpoint', {
  stage: 'pr-opened',
  pr: pr('factory/old-coupons', 409, 240),
});
const approved = task('Add an index on orders.created_at', {
  stage: 'approved',
  worktree: worktree('factory/orders-index'),
  events: [{ at: min(8), kind: 'approval', message: 'Approved' }],
});

const input: BoardInput = {
  tasks: [
    {
      task: coding,
      run: {
        phase: 'running',
        activity: { run_started_at: min(9), command: 'pnpm vitest run checkout', command_started_at: min(1) },
      },
    },
    { task: failing, run: { phase: 'failed' } },
    { task: blocked },
    { task: gate },
    { task: prReview },
    { task: prReady },
    { task: approved },
    { task: task('An old rejected idea', { stage: 'rejected' }) },
  ],
  inbox: [
    {
      id: `failed:shop:${failing.id}`,
      kind: 'failed',
      project: 'shop',
      title: failing.prompt,
      action: 'Read the log, then run again or reject',
      since: min(40),
      task_id: failing.id,
    },
  ],
  pulls: {
    shop: [
      {
        number: 412,
        branch: 'factory/order-status',
        url: 'https://github.com/example/shop/pull/412',
        isDraft: false,
        decision: 'changes',
        author: 'jdoe',
      },
      {
        number: 409,
        branch: 'factory/old-coupons',
        url: 'https://github.com/example/shop/pull/409',
        isDraft: false,
        decision: 'approved',
        author: 'jdoe',
      },
    ],
  },
};

const long =
  'Rework the shipping rules so that orders with mixed fulfilment centres split into separate parcels, each with its own delivery estimate and tracking number';
const longInput: BoardInput = {
  tasks: [
    {
      task: task(long, { worktree: worktree('factory/rework-shipping-rules-for-mixed-fulfilment-centres') }),
      run: { phase: 'queued', label: 'Running classify → code → verify → review' },
    },
    { task: task(long, { stage: 'awaiting-approval', project: 'warehouse', repo: '/repos/warehouse' }) },
  ],
};

const meta = {
  title: 'Factory/Board',
  component: Board,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Home board: Working, Needs me, In review and Ready columns built by `buildBoard` from tasks, run phases, inbox items and open PRs. Fixtures are fictional.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="h-[640px] overflow-hidden rounded-xl border bg-background">
        <Story />
      </div>
    ),
  ],
  args: { board: buildBoard(input), now: NOW, newTaskHref: '/projects/shop/tasks/new' },
} satisfies Meta<typeof Board>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const [name, count] of [
      ['Working', 1],
      ['Needs me', 2],
      ['In review', 2],
      ['Ready', 2],
    ] as const)
      await expect(
        canvas.getByRole('heading', { name: new RegExp(`^${name}\\W+${count} tasks?$`) }),
      ).toBeVisible();
    await expect(canvas.getByText('Archived 1')).toBeVisible();
    await expect(canvas.getByRole('link', { name: /Merge/ })).toHaveAttribute(
      'href',
      'https://github.com/example/shop/pull/409',
    );
    // New task, then the scrollable columns region, then the first card.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: coding.prompt })).toHaveFocus();
  },
};

export const Dark: Story = { globals: { theme: 'dark' } };

export const Empty: Story = {
  args: { board: buildBoard({ tasks: [] }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('No tasks')).toHaveLength(4);
  },
};

export const LongTitles: Story = {
  args: { board: buildBoard(longInput), showProject: true },
};

export const LongTitlesDark: Story = {
  args: { board: buildBoard(longInput), showProject: true },
  globals: { theme: 'dark' },
};
