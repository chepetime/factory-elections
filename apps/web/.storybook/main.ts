import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
  async viteFinal(base) {
    return mergeConfig(base, {
      // @factory/core reads this at import time; stories that build fixtures with core use its default.
      define: { 'process.env.FACTORY_CONTEXT_TOKENS': 'undefined' },
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('../src', import.meta.url)),
          // Components that link with next/link render outside the Next runtime here.
          'next/link': fileURLToPath(new URL('./next-link.tsx', import.meta.url)),
        },
      },
    });
  },
};

export default config;
