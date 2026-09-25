import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // nodemailer opens real TCP sockets — keep it out of the bundler.
  serverExternalPackages: ['nodemailer'],

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};

export default nextConfig;
