import { eratoComponentKitTestDedupe } from "@erato/frontend/component-kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  // A kit and the host it borrows from must share these module instances.
  resolve: {
    dedupe: [...eratoComponentKitTestDedupe],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
