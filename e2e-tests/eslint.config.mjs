import tsParser from "@typescript-eslint/parser";
import playwright from "eslint-plugin-playwright";

export default [
  {
    ignores: [
      "tests-examples/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { playwright },
    rules: {
      // Sleeps are never synchronization: wait on an observable (response,
      // rendered state, stream frame) instead. Bounded absence-window
      // exceptions carry a justified disable comment.
      "playwright/no-wait-for-timeout": "error",
    },
  },
];
