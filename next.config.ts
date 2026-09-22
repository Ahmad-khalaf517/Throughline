import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // postgres.js uses Node APIs not safe to bundle for the server runtime
  // (Project Setup section 5.5).
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
