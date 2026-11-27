import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// The scripts run webpack (`--webpack`), like apps/web: pnpm's global virtual store links `next`
// from outside the repository, and Turbopack refuses to resolve files outside its root.
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/docs.md', destination: '/llms.mdx/docs.md' },
      { source: '/docs/:path*.md', destination: '/llms.mdx/docs/:path*.md' },
      { source: '/docs/:path*.txt', destination: '/llms.mdx/docs/:path*.txt' },
    ];
  },
};

export default withMDX(config);
