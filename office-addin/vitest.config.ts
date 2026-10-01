import { defineConfig } from "vitest/config";
import path from "node:path";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
    lingui({ configPath: "../frontend/lingui.config.ts" }),
  ],
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setupOffice.ts"],
  },
});
