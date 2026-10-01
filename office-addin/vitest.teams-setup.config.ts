import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  test: {
    environment: "node",
    include: ["src/pages/__tests__/teamsBotSetup.powershell.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
