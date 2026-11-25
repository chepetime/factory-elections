import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// Content lives in the repository `docs/` folder, outside this package, so
// imports in the compiled pages cannot find this package's node_modules.
// Point them at the installed copy.
const fumadocsServer = './node_modules/fumadocs-core/dist/server.js';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      'fumadocs-core/server': {
        browser: './node_modules/fumadocs-core/dist/server.browser.js',
        default: fumadocsServer,
      },
    },
  },
  async rewrites() {
    return [
      { source: '/docs.md', destination: '/llms.mdx/docs.md' },
      { source: '/docs/:path*.md', destination: '/llms.mdx/docs/:path*.md' },
      { source: '/docs/:path*.txt', destination: '/llms.mdx/docs/:path*.txt' },
    ];
  },
};

export default withMDX(config);
