import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// Shares the vite plugins and the version define so a test compiles the
// lingui macros and the catalogs exactly as the bundle does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./src/test/setup.ts"],
    },
  }),
);
