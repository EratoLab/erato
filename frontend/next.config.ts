import type { NextConfig } from "next";

const nextConfig = (phase: any) => {
  const nextConfig: NextConfig = {
    output: phase === "phase-production-build" ? "export" : "standalone",
  };
  return nextConfig;
};

export default nextConfig;
