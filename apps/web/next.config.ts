import type { NextConfig } from 'next';

const config: NextConfig = {
  // The domain package is TypeScript source shared with the CLI.
  transpilePackages: ['@factory/core'],
  poweredByHeader: false,
};

export default config;
