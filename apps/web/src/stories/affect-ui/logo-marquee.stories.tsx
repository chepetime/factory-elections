import type { Meta, StoryObj } from '@storybook/react-vite';
import { LogoMarquee } from '@factory/affect-ui/blocks/logo-marquee-clean';
import { LogoMarquee as ClassicLogoMarquee } from '@factory/affect-ui/blocks/logo-marquee';
import { Settings, Check, Folder, ScanSearch } from 'lucide-react';

const meta = {
  title: 'affectUI/Blocks/Logo Marquee',
  component: LogoMarquee,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The endless \u201cTrusted by\u201d strip. Official MIT source. [Usage reference](https://www.affectui.com/blocks/logo-marquee) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/blocks/logo-marquee-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Sample integrations',
    logos: [
      { name: 'Factory', svg: <Settings aria-hidden="true" /> },
      { name: 'Checks', svg: <Check aria-hidden="true" /> },
      { name: 'Projects', svg: <Folder aria-hidden="true" /> },
      { name: 'Review', svg: <ScanSearch aria-hidden="true" /> },
    ],
    labels: 'beside',
    speed: 20,
  },
} satisfies Meta<typeof LogoMarquee>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicLogoMarquee {...args} /> };
