import { useEffect, type ReactNode } from 'react';
import type { Preview } from '@storybook/react-vite';
import { MotionConfig } from 'motion/react';
import '../src/app/globals.css';

function ThemeFrame({ dark, children }: { dark: boolean; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    return () => document.documentElement.classList.remove('dark');
  }, [dark]);
  return (
    <div className={dark ? 'dark' : undefined}>
      <div className="affect-ui-theme min-h-screen bg-background px-4 py-6 font-sans text-foreground antialiased sm:px-6">
        <div className="mx-auto max-w-4xl">
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </div>
      </div>
    </div>
  );
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Component theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { test: 'error' },
    options: { storySort: { order: ['Library', 'Factory', 'affectUI', 'shadcn'] } },
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' } },
        tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop', styles: { width: '1280px', height: '900px' } },
      },
    },
  },
  decorators: [
    (Story, context) => (
      <ThemeFrame dark={context.globals.theme === 'dark'}>
        <Story />
      </ThemeFrame>
    ),
  ],
};

export default preview;
