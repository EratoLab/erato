import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  // A kit and the host it borrows from must agree on these instances; in the
  // app the import map guarantees it, and here the bundler has to.
  resolve: {
    dedupe: [
      "@lingui/core",
      "@lingui/react",
      "@tanstack/react-query",
      "react",
      "react-dom",
      "react-router",
      "react-router-dom",
    ],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
