import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pagination } from '@factory/affect-ui/components/pagination-clean';
import { Pagination as ClassicPagination } from '@factory/affect-ui/components/pagination';
import { expect, fn, userEvent, within } from 'storybook/test';
import { useState, type ComponentProps } from 'react';

const meta = {
  title: 'affectUI/Components/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Pages of a long list. Official MIT source. [Usage reference](https://www.affectui.com/components/pagination) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/pagination-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Next page' }));
    await expect(args.onPageChange).toHaveBeenCalledWith(2);
    await expect(canvas.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  },
  args: { page: 1, total: 128, pageSize: 10, onPageChange: fn() },
  render: (args) => <PaginationPreview key={args.page} {...args} />,
} satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <PaginationPreview key={args.page} {...args} classic /> };

function PaginationPreview({
  classic = false,
  ...args
}: ComponentProps<typeof Pagination> & { classic?: boolean }) {
  const [page, setPage] = useState(args.page);
  const Component = classic ? ClassicPagination : Pagination;
  return (
    <Component
      {...args}
      page={page}
      onPageChange={(next) => {
        setPage(next);
        args.onPageChange(next);
      }}
    />
  );
}
