import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MSAL Node requires native modules — keep server-side only
  serverExternalPackages: ['@azure/msal-node'],
  
  // Allow Stitch/AnyHealth image assets
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};

export default nextConfig;
