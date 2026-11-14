import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmailDraft } from '@factory/affect-ui/components/email-draft-clean';
import { EmailDraft as ClassicEmailDraft } from '@factory/affect-ui/components/email-draft';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Email Draft',
  component: EmailDraft,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Agent-written email for review. Official MIT source. [Usage reference](https://www.affectui.com/components/email-draft) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/email-draft-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    reference: 'Sample project update',
    account: 'Factory demo',
    amount: '12 tasks',
    contacts: [
      { name: 'Alex Rivera', email: 'alex@example.com' },
      { name: 'Morgan Lee', email: 'morgan@example.com' },
    ],
    attachment: 'review-summary.pdf',
    tones: [
      {
        id: 'brief',
        label: 'Brief',
        body: (contact) =>
          `Hi ${contact.name}, the sample project review is ready. Two items need your input.`,
      },
    ],
    onSend: fn(),
    onDiscard: fn(),
  },
} satisfies Meta<typeof EmailDraft>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicEmailDraft {...args} /> };
