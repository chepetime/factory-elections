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
      optimizeDeps: { include: ['@base-ui/react/menu'] },
      resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    });
  },
};

export default config;
