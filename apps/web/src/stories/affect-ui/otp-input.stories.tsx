import type { Meta, StoryObj } from '@storybook/react-vite';
import { OtpInput } from '@factory/affect-ui/components/otp-input-clean';
import { OtpInput as ClassicOtpInput } from '@factory/affect-ui/components/otp-input';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/OTP Input',
  component: OtpInput,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The verification code field done right. Official MIT source. [Usage reference](https://www.affectui.com/components/otp-input) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/otp-input-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Verification code',
    length: 6,
    separator: 3,
    defaultValue: '123',
    onChange: fn(),
    onComplete: fn(),
    onResend: fn(),
  },
} satisfies Meta<typeof OtpInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicOtpInput {...args} /> };
