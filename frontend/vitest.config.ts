import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./src/lib/setupTests.ts"],
    server: {
      deps: {
        inline: [
          "@extend-ai/react-pptx",
          "@extend-ai/react-xlsx",
          "@storybook/test",
          "us-atlas",
          "world-atlas",
        ],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
