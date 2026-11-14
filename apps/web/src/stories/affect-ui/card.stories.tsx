import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, CardHeader, CardContent, CardFooter } from '@factory/affect-ui/components/card-clean';
import {
  Card as ClassicCard,
  CardHeader as ClassicCardHeader,
  CardContent as ClassicCardContent,
  CardFooter as ClassicCardFooter,
} from '@factory/affect-ui/components/card';

const meta = {
  title: 'affectUI/Components/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The card every screen is built from. Official MIT source. [Usage reference](https://www.affectui.com/components/card) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/card-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    children: (
      <>
        <CardHeader title="Project overview" description="A sample factory project" />
        <CardContent>
          <p className="text-sm">12 tasks reviewed. Two decisions need your input.</p>
        </CardContent>
        <CardFooter>Updated a moment ago</CardFooter>
      </>
    ),
  },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = {
  render: (args) => (
    <ClassicCard {...args}>
      <ClassicCardHeader title="Project overview" description="A sample factory project" />
      <ClassicCardContent>
        <p className="text-sm">12 tasks reviewed. Two decisions need your input.</p>
      </ClassicCardContent>
      <ClassicCardFooter>Updated a moment ago</ClassicCardFooter>
    </ClassicCard>
  ),
};
