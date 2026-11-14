import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside the React server build; tests import server modules directly.
      'server-only': fileURLToPath(new URL('./test/fixtures/server-only.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/**/*.test.{ts,tsx}'], environment: 'node' } },
      ...(['light', 'dark'] as const).map((theme) => ({
        extends: true as const,
        plugins: [
          storybookTest({
            configDir: fileURLToPath(new URL('./.storybook', import.meta.url)),
            initialGlobals: { theme },
          }),
        ],
        test: {
          name: `storybook-${theme}`,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
            instances: [{ browser: 'chromium' as const }],
          },
        },
      })),
    ],
  },
});
