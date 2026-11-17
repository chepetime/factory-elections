import type { NextConfig } from 'next';

const config: NextConfig = {
  // The domain package is TypeScript source shared with the CLI.
  transpilePackages: ['@factory/core', '@factory/backend'],
  serverExternalPackages: ['@grpc/grpc-js', '@grpc/proto-loader'],
  poweredByHeader: false,
  // The bottom-left default covers the app shell's account avatar.
  devIndicators: { position: 'bottom-right' },
};

export default config;
