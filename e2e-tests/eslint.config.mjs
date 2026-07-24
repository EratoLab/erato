import tsParser from "@typescript-eslint/parser";
import playwright from "eslint-plugin-playwright";

export default [
  {
    // Local-only suites pending the CI-enablement decision; their sleeps get
    // converted when they are promoted to @ci.
    ignores: [
      "tests/token-warnings.basic.spec.ts",
      "tests/message-id-lifecycle.basic.spec.ts",
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
