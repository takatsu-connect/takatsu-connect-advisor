import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // prompts/ 配下を Node.js ランタイムで fs から読むため、Vercel にファイルを含める
  outputFileTracingIncludes: {
    "app/api/chat/route": ["./prompts/**/*.md"],
  },
};

export default nextConfig;
