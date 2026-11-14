import type { Meta, StoryObj } from '@storybook/react-vite';
import { FreeComponentLibrary } from '@/components/free-component-library';

const meta = {
  title: 'Library/Free Catalog',
  component: FreeComponentLibrary,
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component:
          'Search all 74 locally installed MIT items and inspect import paths, style variants, and pinned upstream source. Three featured modules include live previews.',
      },
    },
  },
} satisfies Meta<typeof FreeComponentLibrary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Browse: Story = {};
