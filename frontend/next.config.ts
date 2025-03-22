import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove static export to allow dynamic routes
  // output: "export",
  trailingSlash: true,
  /* config options here */
};

export default nextConfig;
