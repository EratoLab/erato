import { eratoComponentKitTestDedupe } from "@erato/frontend/component-kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  // A kit and the host it borrows from must agree on these instances; in the
  // app the import map guarantees it, and here the bundler has to. The list
  // comes from that same import map rather than being copied.
  resolve: {
    dedupe: [...eratoComponentKitTestDedupe],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
