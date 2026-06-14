import type { NextConfig } from "next";

const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const nextConfig: NextConfig = {
  async rewrites() {
    if (!firebaseProjectId) return [];

    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${firebaseProjectId}.firebaseapp.com/__/auth/:path*`,
      },
      {
        source: "/__/firebase/init.json",
        destination: `https://${firebaseProjectId}.firebaseapp.com/__/firebase/init.json`,
      },
    ];
  },
};

export default nextConfig;
